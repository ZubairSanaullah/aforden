/**
 * Phase 1.16.9 — Dead Letter Queue (DLQ) Management Services
 *
 * Implements DLQ inspection, diagnostics, replay, and purge for executions
 * that exhaust retries or encounter non-recoverable pipeline errors.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  AutomationExecutionStatus,
  MembershipRole,
} from "@/generated/prisma/enums";
import {
  AutomationExecutionNotFoundError,
  AutomationValidationError,
  AutomationAuthorizationError,
} from "./automationErrors";
import { executeAutomationPipeline } from "./executionEngineService";
import type {
  DbClient,
  WorkspaceAuthorizationContext,
  ExecutionPipelineResult,
} from "./automation.types";

export interface DeadLetterRecord {
  id: string;
  executionId: string;
  workspaceId: string;
  ruleId: string | null;
  ruleName?: string;
  correlationId: string;
  causalityChain: string[];
  executionDepth: number;
  status: AutomationExecutionStatus;
  reasonCode: string | null;
  failedStepOrder?: number;
  failedActionType?: string;
  attemptCount?: number;
  errorCategory?: string;
  errorJson: unknown;
  triggerPayloadJson: unknown;
  deadLetteredAt: Date;
  replayedAt?: Date | null;
  replayExecutionId?: string | null;
  isPurged?: boolean;
  createdAt: Date;
}

export interface ListDeadLetterQuery {
  page?: number;
  pageSize?: number;
  ruleId?: string;
  search?: string;
  reasonCode?: string;
}

export interface ListDeadLetterResult {
  items: DeadLetterRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DlqReplayResult {
  originalExecutionId: string;
  replayExecutionId: string;
  status: AutomationExecutionStatus;
  pipelineResult: ExecutionPipelineResult;
  replayedAt: Date;
}

/**
 * Checks authorization context for DLQ management permissions.
 */
function assertDlqAuthorization(
  actor: WorkspaceAuthorizationContext | undefined,
  requiredRole: "VIEW" | "MANAGE",
): void {
  if (!actor) return;
  const role = (actor as any).membership?.role ?? actor.role;

  if (requiredRole === "MANAGE") {
    if (role !== MembershipRole.OWNER && role !== MembershipRole.ADMIN) {
      throw new AutomationAuthorizationError(
        "Only OWNER and ADMIN roles are permitted to manage or replay Dead Letter Queue executions",
      );
    }
  } else {
    // VIEW allows OWNER, ADMIN, MANAGER
    if (
      role !== MembershipRole.OWNER &&
      role !== MembershipRole.ADMIN &&
      role !== MembershipRole.MANAGER
    ) {
      throw new AutomationAuthorizationError(
        "Insufficient permissions to view Dead Letter Queue",
      );
    }
  }
}

/**
 * Lists Dead Letter Queue executions for a workspace with tenant isolation (Invariant 1).
 */
export async function listDeadLetterExecutions(
  workspaceId: string,
  query: ListDeadLetterQuery = {},
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
): Promise<ListDeadLetterResult> {
  const db = (client ?? defaultPrisma) as PrismaClient;
  assertDlqAuthorization(actor, "VIEW");

  if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.AutomationExecutionWhereInput = {
    workspaceId, // INVARIANT 1: Strict tenant isolation
    status: {
      in: [
        AutomationExecutionStatus.FAILED,
        AutomationExecutionStatus.TIMED_OUT,
      ],
    },
    ...(query.ruleId ? { ruleId: query.ruleId } : {}),
    ...(query.reasonCode ? { reasonCode: query.reasonCode } : {}),
    ...(query.search
      ? {
          OR: [
            { correlationId: { contains: query.search, mode: "insensitive" } },
            { reasonCode: { contains: query.search, mode: "insensitive" } },
            { rule: { name: { contains: query.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [total, executions] = await Promise.all([
    db.automationExecution.count({ where }),
    db.automationExecution.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        rule: { select: { id: true, name: true } },
        steps: {
          where: {
            status: {
              in: ["FAILED", "TIMED_OUT"],
            },
          },
          orderBy: { stepOrder: "asc" },
        },
      },
    }),
  ]);

  const items: DeadLetterRecord[] = executions.map((exec) => {
    const failedStep = exec.steps[0];
    const errObj = (exec.errorJson as Record<string, any>) ?? {};

    return {
      id: exec.id,
      executionId: exec.id,
      workspaceId: exec.workspaceId,
      ruleId: exec.ruleId,
      ruleName: exec.rule?.name,
      correlationId: exec.correlationId,
      causalityChain: exec.causalityChain,
      executionDepth: exec.executionDepth,
      status: exec.status,
      reasonCode: exec.reasonCode,
      failedStepOrder: failedStep?.stepOrder ?? errObj.failedStepOrder,
      failedActionType: failedStep?.actionType ?? errObj.failedActionType,
      attemptCount: errObj.attempts ?? errObj.attemptCount ?? (failedStep ? 1 : 0),
      errorCategory: errObj.category ?? errObj.errorCategory ?? "PERMANENT",
      errorJson: exec.errorJson,
      triggerPayloadJson: exec.triggerPayloadJson,
      deadLetteredAt: exec.completedAt ?? exec.createdAt,
      replayedAt: errObj.replayedAt ? new Date(errObj.replayedAt) : null,
      replayExecutionId: errObj.replayExecutionId ?? null,
      isPurged: !!errObj.isPurged,
      createdAt: exec.createdAt,
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

/**
 * Retrieves full diagnostic detail for a single Dead Letter Queue execution.
 */
export async function getDeadLetterExecution(
  workspaceId: string,
  executionId: string,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
): Promise<DeadLetterRecord & { steps: any[] }> {
  const db = (client ?? defaultPrisma) as PrismaClient;
  assertDlqAuthorization(actor, "VIEW");

  if (!workspaceId || !executionId) {
    throw new AutomationValidationError("Valid workspaceId and executionId are required");
  }

  const execution = await db.automationExecution.findFirst({
    where: {
      id: executionId,
      workspaceId, // INVARIANT 1: Strict tenant isolation
    },
    include: {
      rule: true,
      steps: {
        orderBy: { stepOrder: "asc" },
      },
    },
  });

  if (!execution) {
    throw new AutomationExecutionNotFoundError(
      `Dead Letter Execution '${executionId}' not found in workspace '${workspaceId}'`,
    );
  }

  const failedStep = execution.steps.find((s) => s.status === "FAILED" || s.status === "TIMED_OUT");
  const errObj = (execution.errorJson as Record<string, any>) ?? {};

  return {
    id: execution.id,
    executionId: execution.id,
    workspaceId: execution.workspaceId,
    ruleId: execution.ruleId,
    ruleName: execution.rule?.name,
    correlationId: execution.correlationId,
    causalityChain: execution.causalityChain,
    executionDepth: execution.executionDepth,
    status: execution.status,
    reasonCode: execution.reasonCode,
    failedStepOrder: failedStep?.stepOrder ?? errObj.failedStepOrder,
    failedActionType: failedStep?.actionType ?? errObj.failedActionType,
    attemptCount: errObj.attempts ?? errObj.attemptCount ?? 1,
    errorCategory: errObj.category ?? "PERMANENT",
    errorJson: execution.errorJson,
    triggerPayloadJson: execution.triggerPayloadJson,
    deadLetteredAt: execution.completedAt ?? execution.createdAt,
    replayedAt: errObj.replayedAt ? new Date(errObj.replayedAt) : null,
    replayExecutionId: errObj.replayExecutionId ?? null,
    isPurged: !!errObj.isPurged,
    createdAt: execution.createdAt,
    steps: execution.steps,
  };
}

/**
 * Replays a Dead Letter Queue execution by dispatching a fresh execution through
 * the sequential pipeline and updating the DLQ record audit trail.
 */
export async function replayDeadLetterExecution(
  workspaceId: string,
  executionId: string,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
): Promise<DlqReplayResult> {
  const db = (client ?? defaultPrisma) as PrismaClient;
  assertDlqAuthorization(actor, "MANAGE");

  if (!workspaceId || !executionId) {
    throw new AutomationValidationError("Valid workspaceId and executionId are required");
  }

  // 1. Fetch original DLQ execution
  const original = await db.automationExecution.findFirst({
    where: {
      id: executionId,
      workspaceId, // INVARIANT 1: Strict tenant isolation
    },
    include: {
      rule: true,
    },
  });

  if (!original) {
    throw new AutomationExecutionNotFoundError(
      `Dead Letter Execution '${executionId}' not found in workspace '${workspaceId}'`,
    );
  }

  if (!original.ruleId) {
    throw new AutomationValidationError(
      `Cannot replay execution '${executionId}' because its parent rule has been deleted`,
    );
  }

  const now = new Date();
  const replayCorrelationId = `replay_${original.correlationId}_${Date.now()}`;

  // 2. Create fresh execution record for replay
  const replayExecution = await db.automationExecution.create({
    data: {
      workspaceId,
      ruleId: original.ruleId,
      status: AutomationExecutionStatus.PENDING,
      correlationId: replayCorrelationId,
      parentExecutionId: original.id,
      causalityChain: [],
      executionDepth: 0,
      triggerPayloadJson: (original.triggerPayloadJson as Prisma.InputJsonValue) ?? {},
      dedupeKey: `replay_${original.id}_${Date.now()}`,
    },
  });

  // 3. Dispatch through sequential pipeline
  const pipelineResult = await executeAutomationPipeline(
    workspaceId,
    replayExecution.id,
    { now },
    db,
  );

  // 4. Update original DLQ execution record with replay audit metadata
  const existingErrJson = (original.errorJson as Record<string, any>) ?? {};
  await db.automationExecution.update({
    where: { id: original.id },
    data: {
      errorJson: {
        ...existingErrJson,
        replayedAt: now.toISOString(),
        replayExecutionId: replayExecution.id,
        replayStatus: pipelineResult.status,
        replayCount: (existingErrJson.replayCount ?? 0) + 1,
      },
    },
  });

  return {
    originalExecutionId: original.id,
    replayExecutionId: replayExecution.id,
    status: pipelineResult.status,
    pipelineResult,
    replayedAt: now,
  };
}

/**
 * Purges / marks a DLQ execution as acknowledged/resolved without deleting immutable audit history.
 */
export async function purgeDeadLetterExecution(
  workspaceId: string,
  executionId: string,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
): Promise<{ success: boolean; purgedExecutionId: string }> {
  const db = (client ?? defaultPrisma) as PrismaClient;
  assertDlqAuthorization(actor, "MANAGE");

  if (!workspaceId || !executionId) {
    throw new AutomationValidationError("Valid workspaceId and executionId are required");
  }

  const original = await db.automationExecution.findFirst({
    where: {
      id: executionId,
      workspaceId, // INVARIANT 1: Strict tenant isolation
    },
  });

  if (!original) {
    throw new AutomationExecutionNotFoundError(
      `Dead Letter Execution '${executionId}' not found in workspace '${workspaceId}'`,
    );
  }

  const existingErrJson = (original.errorJson as Record<string, any>) ?? {};
  await db.automationExecution.update({
    where: { id: original.id },
    data: {
      errorJson: {
        ...existingErrJson,
        isPurged: true,
        purgedAt: new Date().toISOString(),
        purgedBy: actor?.userId ?? "SYSTEM",
      },
    },
  });

  return {
    success: true,
    purgedExecutionId: executionId,
  };
}
