/**
 * Phase 1.16.7 — Automation Schedule Job Service & Polling Engine
 *
 * Manages time-driven scheduled triggers (SCHEDULED_CRON, SCHEDULED_INTERVAL, SCHEDULED_ENTITY_OFFSET),
 * executes concurrency-safe polling worker ticks, and orchestrates downstream pipeline execution.
 */

import { prisma as defaultPrisma } from "@/lib/prisma";
import type { PrismaClient, Prisma, AutomationScheduleJob } from "@/generated/prisma/client";
import { AutomationExecutionStatus } from "@/generated/prisma/enums";
import type {
  EntityOffsetConfig,
  RegisterScheduleJobInput,
  SchedulePollingOptions,
  SchedulePollingSummary,
} from "./automation.types";
import {
  AutomationValidationError,
  AutomationRuleNotFoundError,
  AutomationScheduleJobNotFoundError,
} from "./automationErrors";
import { computeNextCronRun } from "./cronEngine";
import { computeNextIntervalRun } from "./intervalEngine";
import { resolveEntityOffsetNextRun } from "./entityOffsetEngine";
import { runAutomationWorkflow } from "./executionEngineService";

type DbClient = PrismaClient | Prisma.TransactionClient;

const DEFAULT_MAX_JOBS_PER_POLL = 50;
const DEFAULT_MAX_FAILURE_THRESHOLD = 5;

/**
 * Computes the next scheduled execution timestamp for an AutomationScheduleJob.
 */
export async function computeScheduleJobNextRun(
  job: {
    workspaceId: string;
    scheduleKind: string;
    cronExpression?: string | null;
    intervalSeconds?: number | null;
    entityOffsetJson?: unknown;
    lastRunAt?: Date | null;
  },
  fromDate: Date = new Date(),
  client?: DbClient,
  actorContext?: any,
): Promise<Date | null> {
  switch (job.scheduleKind) {
    case "SCHEDULED_CRON": {
      if (!job.cronExpression) {
        throw new AutomationValidationError("cronExpression is required for SCHEDULED_CRON jobs");
      }
      return computeNextCronRun(job.cronExpression, fromDate);
    }

    case "SCHEDULED_INTERVAL": {
      if (!job.intervalSeconds) {
        throw new AutomationValidationError(
          "intervalSeconds is required for SCHEDULED_INTERVAL jobs",
        );
      }
      return computeNextIntervalRun(job.intervalSeconds, job.lastRunAt, fromDate);
    }

    case "SCHEDULED_ENTITY_OFFSET": {
      if (!job.entityOffsetJson) {
        throw new AutomationValidationError(
          "entityOffsetJson is required for SCHEDULED_ENTITY_OFFSET jobs",
        );
      }
      return resolveEntityOffsetNextRun(
        job.workspaceId,
        job.entityOffsetJson as EntityOffsetConfig,
        client,
        actorContext,
      );
    }

    default:
      throw new AutomationValidationError(
        `Unsupported scheduleKind '${job.scheduleKind}'`,
      );
  }
}

/**
 * Registers a new AutomationScheduleJob for an existing AutomationRule.
 */
export async function registerScheduleJob(
  workspaceId: string,
  input: RegisterScheduleJobInput,
  client?: DbClient,
  actorContext?: any,
): Promise<AutomationScheduleJob> {
  const db = (client ?? defaultPrisma) as PrismaClient;

  if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }

  if (!input.ruleId || typeof input.ruleId !== "string") {
    throw new AutomationValidationError("ruleId is required");
  }

  if (!input.scheduleKind || typeof input.scheduleKind !== "string") {
    throw new AutomationValidationError("scheduleKind is required");
  }

  // Verify Rule exists in tenant workspace (Invariant 1)
  const rule = await db.automationRule.findFirst({
    where: {
      id: input.ruleId,
      workspaceId,
    },
  });

  if (!rule) {
    throw new AutomationRuleNotFoundError(
      `AutomationRule '${input.ruleId}' not found in workspace '${workspaceId}'`,
    );
  }

  // Compute initial nextRunAt
  const nextRunAt = await computeScheduleJobNextRun(
    {
      workspaceId,
      scheduleKind: input.scheduleKind,
      cronExpression: input.cronExpression,
      intervalSeconds: input.intervalSeconds,
      entityOffsetJson: input.entityOffsetJson,
      lastRunAt: null,
    },
    new Date(),
    db,
    actorContext,
  );

  return db.automationScheduleJob.create({
    data: {
      workspaceId, // INVARIANT 1
      ruleId: input.ruleId,
      scheduleKind: input.scheduleKind,
      cronExpression: input.cronExpression ?? null,
      intervalSeconds: input.intervalSeconds ?? null,
      entityOffsetJson: (input.entityOffsetJson as Prisma.InputJsonValue) ?? null,
      nextRunAt,
      lastRunAt: null,
      isActive: input.isActive ?? true,
      failureCount: 0,
    },
  });
}

/**
 * Executes a single polling tick across due `AutomationScheduleJob` records.
 *
 * Query optimization: Utilizes `@@index([workspaceId, isActive, nextRunAt])`.
 * Concurrency safety: Employs atomic conditional update matching exact `nextRunAt`
 * to guarantee exactly-once pipeline firing even when worker runs overlap.
 *
 * @param workspaceId - Optional filter to poll a specific workspace
 * @param options - Polling options (now, maxJobsPerPoll, maxFailureThreshold)
 * @param client - Optional Prisma client
 */
export async function pollAndDispatchDueScheduleJobs(
  workspaceId?: string,
  options?: SchedulePollingOptions,
  client?: DbClient,
): Promise<SchedulePollingSummary> {
  const db = (client ?? defaultPrisma) as PrismaClient;
  const now = options?.now ?? new Date();
  const maxJobs = options?.maxJobsPerPoll ?? DEFAULT_MAX_JOBS_PER_POLL;
  const maxFailureThreshold = options?.maxFailureThreshold ?? DEFAULT_MAX_FAILURE_THRESHOLD;

  // 1. Fetch due jobs using @@index([workspaceId, isActive, nextRunAt])
  const dueJobs = await db.automationScheduleJob.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      isActive: true,
      nextRunAt: { lte: now },
    },
    take: maxJobs,
    orderBy: { nextRunAt: "asc" },
  });

  const summary: SchedulePollingSummary = {
    polledAt: now,
    jobsChecked: dueJobs.length,
    jobsDispatched: 0,
    jobsSkippedDueToConcurrency: 0,
    jobsFailed: 0,
    jobsDeactivatedByCircuitBreaker: 0,
    results: [],
  };

  if (dueJobs.length === 0) {
    return summary;
  }

  // 2. Process each due job with concurrency lease
  for (const job of dueJobs) {
    // 2a. Pre-compute the subsequent nextRunAt
    let nextRunAt: Date | null = null;
    try {
      nextRunAt = await computeScheduleJobNextRun(
        {
          workspaceId: job.workspaceId,
          scheduleKind: job.scheduleKind,
          cronExpression: job.cronExpression,
          intervalSeconds: job.intervalSeconds,
          entityOffsetJson: job.entityOffsetJson,
          lastRunAt: now,
        },
        now,
        db,
        options?.actorContext,
      );
    } catch (err: any) {
      // If nextRunAt computation fails (e.g. entity deleted)
      const newFailureCount = job.failureCount + 1;
      const isDeactivated = newFailureCount >= maxFailureThreshold;

      await db.automationScheduleJob.update({
        where: { id: job.id },
        data: {
          lastRunAt: now,
          failureCount: newFailureCount,
          isActive: isDeactivated ? false : job.isActive,
        },
      });

      if (isDeactivated) {
        summary.jobsDeactivatedByCircuitBreaker++;
      } else {
        summary.jobsFailed++;
      }

      summary.results.push({
        jobId: job.id,
        ruleId: job.ruleId,
        scheduleKind: job.scheduleKind,
        status: isDeactivated ? "DEACTIVATED" : "FAILED",
        failureCount: newFailureCount,
        error: err.message,
      });
      continue;
    }

    // 2b. Atomic Concurrency Lock: update matching exact current nextRunAt
    const claimResult = await db.automationScheduleJob.updateMany({
      where: {
        id: job.id,
        isActive: true,
        nextRunAt: job.nextRunAt, // Exact condition to prevent race conditions
      },
      data: {
        lastRunAt: now,
        nextRunAt,
      },
    });

    if (claimResult.count === 0) {
      // Job was claimed/modified by a concurrent worker tick!
      summary.jobsSkippedDueToConcurrency++;
      summary.results.push({
        jobId: job.id,
        ruleId: job.ruleId,
        scheduleKind: job.scheduleKind,
        status: "SKIPPED_CONCURRENCY",
        failureCount: job.failureCount,
      });
      continue;
    }

    // 2c. Re-enter the automation pipeline (Stages 1–7)
    try {
      let eventType = "scheduled.interval";
      if (job.scheduleKind === "SCHEDULED_CRON") {
        eventType = "scheduled.cron";
      } else if (job.scheduleKind === "SCHEDULED_ENTITY_OFFSET") {
        eventType = "scheduled.entity_offset";
      } else if (job.scheduleKind === "SCHEDULED_INTERVAL") {
        eventType = "scheduled.interval";
      } else {
        eventType = job.scheduleKind.toLowerCase().replace(/_/g, ".");
      }

      const pipelineResults = await runAutomationWorkflow(
        job.workspaceId,
        {
          workspaceId: job.workspaceId,
          eventType,
          sourceEntity: "AutomationScheduleJob",
          sourceId: job.id,
          payload: {
            scheduleJobId: job.id,
            ruleId: job.ruleId,
            scheduleKind: job.scheduleKind,
            scheduledRunAt: job.nextRunAt?.toISOString(),
            actualRunAt: now.toISOString(),
          },
        },
        {
          now,
          actorContext: options?.actorContext,
          prismaTx: options?.prismaTx,
        },
        db,
      );


      const hasFailure = pipelineResults.some(
        (r) => r.status === AutomationExecutionStatus.FAILED,
      );

      if (hasFailure) {
        const newFailureCount = job.failureCount + 1;
        const isDeactivated = newFailureCount >= maxFailureThreshold;

        await db.automationScheduleJob.update({
          where: { id: job.id },
          data: {
            failureCount: newFailureCount,
            isActive: isDeactivated ? false : true,
          },
        });

        if (isDeactivated) {
          summary.jobsDeactivatedByCircuitBreaker++;
        } else {
          summary.jobsFailed++;
        }

        summary.results.push({
          jobId: job.id,
          ruleId: job.ruleId,
          scheduleKind: job.scheduleKind,
          status: isDeactivated ? "DEACTIVATED" : "FAILED",
          executionId: pipelineResults[0]?.executionId,
          nextRunAt,
          failureCount: newFailureCount,
          error: "Downstream execution failed",
        });
      } else {
        // Success: Reset failure count
        if (job.failureCount > 0) {
          await db.automationScheduleJob.update({
            where: { id: job.id },
            data: { failureCount: 0 },
          });
        }

        summary.jobsDispatched++;
        summary.results.push({
          jobId: job.id,
          ruleId: job.ruleId,
          scheduleKind: job.scheduleKind,
          status: "DISPATCHED",
          executionId: pipelineResults[0]?.executionId,
          nextRunAt,
          failureCount: 0,
        });
      }
    } catch (dispatchErr: any) {
      const newFailureCount = job.failureCount + 1;
      const isDeactivated = newFailureCount >= maxFailureThreshold;

      await db.automationScheduleJob.update({
        where: { id: job.id },
        data: {
          failureCount: newFailureCount,
          isActive: isDeactivated ? false : true,
        },
      });

      if (isDeactivated) {
        summary.jobsDeactivatedByCircuitBreaker++;
      } else {
        summary.jobsFailed++;
      }

      summary.results.push({
        jobId: job.id,
        ruleId: job.ruleId,
        scheduleKind: job.scheduleKind,
        status: isDeactivated ? "DEACTIVATED" : "FAILED",
        nextRunAt,
        failureCount: newFailureCount,
        error: dispatchErr.message,
      });
    }
  }

  return summary;
}
