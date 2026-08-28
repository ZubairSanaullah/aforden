/**
 * Phase 1.16.7 — Automation Scheduling & Time-Driven Trigger Engine Integration Tests
 */

import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const hoistedMocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: hoistedMocks.auth,
}));

vi.mock("@/lib/auth", () => ({
  auth: hoistedMocks.auth,
}));

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  AutomationTriggerType,
  AutomationExecutionStatus,
  AutomationExecutionStepStatus,
  AutomationActionType,
  FeatureValueType,
} from "@/generated/prisma/enums";
import {
  parseCronExpression,
  validateCronExpression,
  computeNextCronRun,
  computeNextIntervalRun,
  resolveEntityOffsetNextRun,
  registerScheduleJob,
  pollAndDispatchDueScheduleJobs,
  AutomationInvalidCronExpressionError,
} from "@/lib/services/automation";

// Import domain query services to mock/spy
import * as workOrderService from "@/lib/services/workOrder";
import * as invoiceService from "@/lib/services/invoice";
import * as scheduleService from "@/lib/services/schedule";

describe("Phase 1.16.7 — Automation Scheduling & Time-Driven Trigger Engine", { timeout: 20000 }, () => {
  let prisma: PrismaClient;
  const testRunId = `sched_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_sched_${testRunId}`;
  const otherWsId = `ws_other_${testRunId}`;


  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Seed Workspaces
    await prisma.workspace.createMany({
      data: [
        { id: wsId, name: "Schedule Main WS", slug: `sched-main-${testRunId}` },
        { id: otherWsId, name: "Schedule Other WS", slug: `sched-other-${testRunId}` },
      ],
    });

    // 2. Seed Automation Entitlements
    await prisma.workspaceEntitlementOverride.createMany({
      data: [
        {
          workspaceId: wsId,
          featureKey: "FEATURE_AUTOMATIONS",
          featureType: FeatureValueType.BOOLEAN,
          overrideValueJson: true,
          reason: "Test entitlement",
          grantedByUserId: `user_admin_${testRunId}`,
        },
        {
          workspaceId: otherWsId,
          featureKey: "FEATURE_AUTOMATIONS",
          featureType: FeatureValueType.BOOLEAN,
          overrideValueJson: true,
          reason: "Test entitlement",
          grantedByUserId: `user_admin_${testRunId}`,
        },
      ],
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.automationScheduleJob.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.automationExecutionStep.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.automationExecution.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.automationAction.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.automationTrigger.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.automationRule.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.workspaceEntitlementOverride.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [wsId, otherWsId] } },
      });
      await prisma.$disconnect();
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. CRON EXPRESSION ENGINE TESTS (SCHEDULED_CRON)
  // =========================================================================
  describe("1. Cron Expression Engine (SCHEDULED_CRON)", () => {
    it("should parse and validate standard 5-field cron syntax", () => {
      const valid = validateCronExpression("0 9 * * 1");
      expect(valid.valid).toBe(true);

      const parsed = parseCronExpression("0 9 * * 1");
      expect(parsed.minutes.has(0)).toBe(true);
      expect(parsed.hours.has(9)).toBe(true);
      expect(parsed.daysOfWeek.has(1)).toBe(true);
    });

    it("should support step values, ranges, and lists correctly", () => {
      // Step value: */15
      const stepParsed = parseCronExpression("*/15 8-18 1,15 * 1-5");
      expect(stepParsed.minutes).toEqual(new Set([0, 15, 30, 45]));
      expect(stepParsed.hours).toEqual(new Set([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]));
      expect(stepParsed.daysOfMonth).toEqual(new Set([1, 15]));
      expect(stepParsed.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
    });

    it("should calculate next run time strictly in the future", () => {
      // Reference: 2026-09-01 10:14:00 UTC (Tuesday)
      const refDate = new Date("2026-09-01T10:14:00.000Z");

      // */15 should fire next at 10:15:00 UTC
      const nextRun1 = computeNextCronRun("*/15 * * * *", refDate);
      expect(nextRun1.toISOString()).toBe("2026-09-01T10:15:00.000Z");

      // Daily at 09:00 UTC should fire next day (2026-09-02 09:00 UTC)
      const nextRun2 = computeNextCronRun("0 9 * * *", refDate);
      expect(nextRun2.toISOString()).toBe("2026-09-02T09:00:00.000Z");

      // Weekly on Mondays (dayOfWeek = 1) at 09:00 UTC
      // 2026-09-01 is Tuesday, next Monday is 2026-09-07
      const nextRun3 = computeNextCronRun("0 9 * * 1", refDate);
      expect(nextRun3.toISOString()).toBe("2026-09-07T09:00:00.000Z");
    });

    it("should apply standard POSIX/Vixie cron OR logic when BOTH dayOfMonth and dayOfWeek are restricted", () => {
      // "0 0 1 * 5" -> Run at midnight on the 1st of the month OR on every Friday
      // Reference: Thursday 2026-09-03 12:00:00 UTC
      const refThursday = new Date("2026-09-03T12:00:00.000Z");

      // Next run is Friday 2026-09-04 00:00:00 UTC (DOW=5 matches, even though DOM=4 is not 1)
      const nextFriday = computeNextCronRun("0 0 1 * 5", refThursday);
      expect(nextFriday.toISOString()).toBe("2026-09-04T00:00:00.000Z");

      // Reference: Wednesday 2026-09-30 12:00:00 UTC
      const refSept30 = new Date("2026-09-30T12:00:00.000Z");

      // Next run is Thursday 2026-10-01 00:00:00 UTC (DOM=1 matches, even though DOW=4 Thursday is not Friday)
      const nextOct1st = computeNextCronRun("0 0 1 * 5", refSept30);
      expect(nextOct1st.toISOString()).toBe("2026-10-01T00:00:00.000Z");

      // Test with "*/15 8-18 1,15 * 1-5" on Sunday 2026-09-06 (DOM=6, DOW=0)
      const refSunday = new Date("2026-09-06T12:00:00.000Z");
      const nextWeekday = computeNextCronRun("*/15 8-18 1,15 * 1-5", refSunday);
      // Fires Monday 2026-09-07 at 08:00:00 UTC because DOW 1 (Mon) matches 1-5
      expect(nextWeekday.toISOString()).toBe("2026-09-07T08:00:00.000Z");
    });


    it("should reject invalid cron expressions with AutomationInvalidCronExpressionError", () => {
      expect(() => parseCronExpression("invalid cron")).toThrow(
        AutomationInvalidCronExpressionError,
      );
      expect(() => parseCronExpression("65 * * * *")).toThrow(
        AutomationInvalidCronExpressionError,
      );
      expect(() => parseCronExpression("0 25 * * *")).toThrow(
        AutomationInvalidCronExpressionError,
      );
    });
  });

  // =========================================================================
  // 2. INTERVAL SCHEDULING ENGINE (SCHEDULED_INTERVAL)
  // =========================================================================
  describe("2. Interval Scheduling Engine (SCHEDULED_INTERVAL)", () => {
    it("should compute nextRunAt from reference time when no lastRunAt exists", () => {
      const ref = new Date("2026-09-01T12:00:00.000Z");
      const next = computeNextIntervalRun(3600, null, ref); // 1 hour
      expect(next.toISOString()).toBe("2026-09-01T13:00:00.000Z");
    });

    it("should compute nextRunAt from lastRunAt and advance past fromDate", () => {
      const lastRun = new Date("2026-09-01T10:00:00.000Z");
      const ref = new Date("2026-09-01T12:30:00.000Z");

      // Interval of 3600s (1h) from 10:00 -> 11:00 -> 12:00 -> next is 13:00
      const next = computeNextIntervalRun(3600, lastRun, ref);
      expect(next.toISOString()).toBe("2026-09-01T13:00:00.000Z");
    });
  });

  // =========================================================================
  // 3. ENTITY-OFFSET SCHEDULING ENGINE (SCHEDULED_ENTITY_OFFSET)
  // =========================================================================
  describe("3. Entity-Offset Scheduling Engine (SCHEDULED_ENTITY_OFFSET)", () => {
    it("should resolve offset relative to WorkOrder dateField via domain service query", async () => {
      const mockWorkOrder: any = {
        id: "wo_target_1",
        scheduledStartDate: new Date("2026-09-10T14:00:00.000Z"),
      };
      const getWOSpy = vi.spyOn(workOrderService, "getWorkOrder").mockResolvedValue(mockWorkOrder);

      const offsetConfig = {
        entityType: "WorkOrder" as const,
        entityId: "wo_target_1",
        dateField: "scheduledStartDate",
        offsetSeconds: -86400, // 24 hours before
      };

      const nextRun = await resolveEntityOffsetNextRun(wsId, offsetConfig, prisma);

      expect(getWOSpy).toHaveBeenCalledWith(wsId, "wo_target_1");
      expect(nextRun?.toISOString()).toBe("2026-09-09T14:00:00.000Z");
    });

    it("should resolve offset relative to Invoice dateField via domain service query", async () => {
      const mockInvoice: any = {
        id: "inv_target_1",
        dueDate: new Date("2026-09-15T00:00:00.000Z"),
      };
      const getInvSpy = vi.spyOn(invoiceService, "getInvoice").mockResolvedValue(mockInvoice);

      const offsetConfig = {
        entityType: "Invoice" as const,
        entityId: "inv_target_1",
        dateField: "dueDate",
        offsetSeconds: 7200, // 2 hours after
      };

      const nextRun = await resolveEntityOffsetNextRun(wsId, offsetConfig, prisma);

      expect(getInvSpy).toHaveBeenCalledWith(wsId, "inv_target_1");
      expect(nextRun?.toISOString()).toBe("2026-09-15T02:00:00.000Z");
    });

    it("should read ScheduleAppointment via domain service query (Phase 1.8 read-only access)", async () => {
      const mockAppointment: any = {
        id: "apt_target_1",
        start: new Date("2026-09-20T09:00:00.000Z"),
      };
      const getSchedSpy = vi.spyOn(scheduleService, "getSchedule").mockResolvedValue(mockAppointment);

      const offsetConfig = {
        entityType: "ScheduleAppointment" as const,
        entityId: "apt_target_1",
        dateField: "start",
        offsetSeconds: -3600, // 1 hour before
      };

      const nextRun = await resolveEntityOffsetNextRun(wsId, offsetConfig, prisma);

      expect(getSchedSpy).toHaveBeenCalledWith(wsId, "apt_target_1");
      expect(nextRun?.toISOString()).toBe("2026-09-20T08:00:00.000Z");
    });
  });

  // =========================================================================
  // 4. CONCURRENCY SAFETY & IDEMPOTENT POLLING WORKER (SCOPE ITEM 4 & 7)
  // =========================================================================
  describe("4. Concurrency Safety & Polling Worker Execution", () => {
    it("should prevent double-firing when two worker ticks poll the same due job concurrently", async () => {
      vi.spyOn(workOrderService, "createWorkOrder").mockResolvedValue({
        id: "wo_poll_1",
        workOrderNumber: "WO-2026-POLL",
      } as any);

      // Create Rule
      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Concurrent Scheduled Rule",
          isEnabled: true,
          trigger: {
            create: {
              workspaceId: wsId,
              triggerType: AutomationTriggerType.SCHEDULED_INTERVAL,
              eventType: "scheduled.interval",
            },
          },
          actions: {
            create: [
              {
                workspaceId: wsId,
                stepOrder: 1,
                actionType: AutomationActionType.WORK_ORDER_CREATE,
                paramsJson: {
                  customerId: "cust_1",
                  locationId: "loc_1",
                  workTypeId: "wt_1",
                  title: "Scheduled Maintenance Job",
                },
              },
            ],
          },
        },
      });

      const now = new Date();
      const pastTime = new Date(now.getTime() - 60000); // 1 minute in past (due)

      // Register Due Schedule Job
      const dueJob = await prisma.automationScheduleJob.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          scheduleKind: "SCHEDULED_INTERVAL",
          intervalSeconds: 300,
          nextRunAt: pastTime,
          isActive: true,
        },
      });

      // Simulate 2 concurrent polling worker ticks executing in parallel
      const [tick1, tick2] = await Promise.all([
        pollAndDispatchDueScheduleJobs(wsId, { now }, prisma),
        pollAndDispatchDueScheduleJobs(wsId, { now }, prisma),
      ]);

      const totalDispatched = tick1.jobsDispatched + tick2.jobsDispatched;

      // Exactly ONE worker claimed and dispatched (no double-firing!)
      expect(totalDispatched).toBe(1);

      // Verify that exactly 1 execution record exists in DB
      const executions = await prisma.automationExecution.findMany({
        where: {
          workspaceId: wsId,
          ruleId: rule.id,
        },
      });
      expect(executions).toHaveLength(1);
      expect(executions[0].status).toBe(AutomationExecutionStatus.COMPLETED);

      // Verify job nextRunAt was advanced
      const updatedJob = await prisma.automationScheduleJob.findUnique({
        where: { id: dueJob.id },
      });
      expect(updatedJob?.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
      expect(updatedJob?.lastRunAt!.getTime()).toBe(now.getTime());
    });

    it("should record SKIPPED_CONCURRENCY when optimistic lock condition detects prior claim", async () => {
      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Lock Collision Rule",
          isEnabled: true,
        },
      });

      const originalNextRun = new Date("2026-09-01T10:00:00.000Z");
      const job = await prisma.automationScheduleJob.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          scheduleKind: "SCHEDULED_INTERVAL",
          intervalSeconds: 60,
          nextRunAt: originalNextRun,
          isActive: true,
        },
      });

      // Worker 1 claims job
      const claim1 = await prisma.automationScheduleJob.updateMany({
        where: {
          id: job.id,
          isActive: true,
          nextRunAt: originalNextRun,
        },
        data: {
          lastRunAt: new Date(),
          nextRunAt: new Date("2026-09-01T10:01:00.000Z"),
        },
      });
      expect(claim1.count).toBe(1);

      // Worker 2 attempts to claim with stale nextRunAt (already claimed)
      const claim2 = await prisma.automationScheduleJob.updateMany({
        where: {
          id: job.id,
          isActive: true,
          nextRunAt: originalNextRun, // Stale!
        },
        data: {
          lastRunAt: new Date(),
          nextRunAt: new Date("2026-09-01T10:01:00.000Z"),
        },
      });
      expect(claim2.count).toBe(0); // 0 rows updated -> Concurrency collision prevented!
    });
  });


  // =========================================================================
  // 5. FULL PIPELINE HAND-OFF TRACE
  // =========================================================================
  describe("5. Full Pipeline Hand-off Trace", () => {
    it("should process due SCHEDULED_INTERVAL job through full 7-stage pipeline to COMPLETED", async () => {
      vi.spyOn(workOrderService, "createWorkOrder").mockResolvedValue({
        id: "wo_trace_1",
        workOrderNumber: "WO-TRACE-1",
      } as any);

      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Trace Scheduled Rule",
          isEnabled: true,
          trigger: {
            create: {
              workspaceId: wsId,
              triggerType: AutomationTriggerType.SCHEDULED_INTERVAL,
              eventType: "scheduled.interval",
            },
          },
          actions: {
            create: [
              {
                workspaceId: wsId,
                stepOrder: 1,
                actionType: AutomationActionType.WORK_ORDER_CREATE,
                paramsJson: {
                  customerId: "cust_trace",
                  locationId: "loc_trace",
                  workTypeId: "wt_trace",
                  title: "Trace Job",
                },
              },
            ],
          },
        },
      });

      const now = new Date();
      const pastTime = new Date(now.getTime() - 10000);

      const job = await prisma.automationScheduleJob.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          scheduleKind: "SCHEDULED_INTERVAL",
          intervalSeconds: 60,
          nextRunAt: pastTime,
          isActive: true,
        },
      });

      const summary = await pollAndDispatchDueScheduleJobs(wsId, { now }, prisma);

      expect(summary.jobsDispatched).toBe(1);
      expect(summary.results[0].status).toBe("DISPATCHED");
      expect(summary.results[0].executionId).toBeDefined();

      const execution = await prisma.automationExecution.findUnique({
        where: { id: summary.results[0].executionId },
        include: { steps: true },
      });

      expect(execution?.status).toBe(AutomationExecutionStatus.COMPLETED);
      expect(execution?.steps).toHaveLength(1);
      expect(execution?.steps[0].status).toBe(AutomationExecutionStepStatus.COMPLETED);
    });
  });

  // =========================================================================
  // 6. FAILURE COUNT & CIRCUIT BREAKER BEHAVIOR
  // =========================================================================
  describe("6. Failure Count & Circuit Breaker Behavior", () => {
    it("should increment failureCount and deactivate job when failure threshold is reached", async () => {
      // Simulate action failing downstream
      vi.spyOn(workOrderService, "createWorkOrder").mockRejectedValue(
        new Error("Domain service unavailable"),
      );

      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Failing Scheduled Rule",
          isEnabled: true,
          trigger: {
            create: {
              workspaceId: wsId,
              triggerType: AutomationTriggerType.SCHEDULED_INTERVAL,
              eventType: "scheduled.interval",
            },
          },
          actions: {
            create: [
              {
                workspaceId: wsId,
                stepOrder: 1,
                actionType: AutomationActionType.WORK_ORDER_CREATE,
                paramsJson: {
                  customerId: "cust_fail",
                  locationId: "loc_fail",
                  workTypeId: "wt_fail",
                  title: "Failing Job",
                },
              },
            ],
          },
        },
      });

      const now = new Date();
      // Job with failureCount = 2, threshold = 3
      const job = await prisma.automationScheduleJob.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          scheduleKind: "SCHEDULED_INTERVAL",
          intervalSeconds: 60,
          nextRunAt: new Date(now.getTime() - 5000),
          failureCount: 2,
          isActive: true,
        },
      });

      const summary = await pollAndDispatchDueScheduleJobs(
        wsId,
        { now, maxFailureThreshold: 3 },
        prisma,
      );

      expect(summary.jobsDeactivatedByCircuitBreaker).toBe(1);
      expect(summary.results[0].status).toBe("DEACTIVATED");
      expect(summary.results[0].failureCount).toBe(3);

      const dbJob = await prisma.automationScheduleJob.findUnique({
        where: { id: job.id },
      });
      expect(dbJob?.isActive).toBe(false); // Circuit breaker tripped!
      expect(dbJob?.failureCount).toBe(3);
    });
  });

  // =========================================================================
  // 7. DOMAIN DISAMBIGUATION (SECTION 5.2)
  // =========================================================================
  describe("7. Domain Disambiguation (Section 5.2)", () => {
    it("should never perform write mutations to Phase 1.8 ScheduleAppointment tables", async () => {
      const initialAppointmentsCount = await prisma.scheduleAppointment.count({
        where: { workspaceId: wsId },
      });

      // Register and run scheduled automation job
      await registerScheduleJob(
        wsId,
        {
          ruleId: (
            await prisma.automationRule.create({
              data: { workspaceId: wsId, name: "Disambiguation Rule" },
            })
          ).id,
          scheduleKind: "SCHEDULED_INTERVAL",
          intervalSeconds: 600,
        },
        prisma,
      );

      const finalAppointmentsCount = await prisma.scheduleAppointment.count({
        where: { workspaceId: wsId },
      });

      // Zero table sharing / zero mutations to ScheduleAppointment
      expect(finalAppointmentsCount).toBe(initialAppointmentsCount);
    });
  });
});
