/**
 * Phase 1.16.10 — Integration Hardening, Concurrency & Security Audit (Lock)
 *
 * Comprehensive cross-subphase integration and concurrency stress test suite.
 * Exercises interactions across subsystems built in isolation across 1.16.2–1.16.9:
 * 1. Multi-Subsystem Race: Concurrent Schedule-Job Polling, Manual Test-Run & DLQ Replay.
 * 2. Concurrent Rule Mutations Racing In-Flight Pipeline Execution.
 * 3. Concurrent Step Retry Loop Racing Asynchronous DLQ Purge.
 * 4. High-Concurrency Tier 1 & Tier 2 Ingestion Thundering Herd with Deduplication.
 * 5. Multi-Tenant Concurrency Fortress (Cross-Tenant Concurrent Stress).
 * 6. Cascading Causality Chain Concurrency with Recursion Depth Guards (D_max = 3).
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
  AutomationErrorPolicy,
  FeatureValueType,
  MembershipRole,
} from "@/generated/prisma/enums";

import {
  createAutomationRule,
  updateAutomationRule,
  testRunAutomationRule,
  executeAutomationPipeline,
  registerScheduleJob,
  pollAndDispatchDueScheduleJobs,
  replayDeadLetterExecution,
  purgeDeadLetterExecution,
  ingestAutomationEvent,
  clearIngestionDedupeCache,
  executeStepWithRetry,
} from "@/lib/services/automation";
import type { ActionExecutionContext } from "@/lib/services/automation/automation.types";

import * as workOrderService from "@/lib/services/workOrder";
import * as notificationService from "@/lib/services/notification";

describe("Phase 1.16.10 — Integration Hardening, Concurrency & Security Audit", { timeout: 35000 }, () => {
  let prisma: PrismaClient;
  const testRunId = `lock_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const ws1Id = `ws_lock1_${testRunId}`;
  const ws2Id = `ws_lock2_${testRunId}`;

  const ownerUserId = `user_owner_${testRunId}`;
  const adminUserId = `user_admin_${testRunId}`;

  const createAuthContext = (userId: string, role: MembershipRole, workspaceId: string) => ({
    userId,
    user: { id: userId, name: `User ${userId}`, email: `${userId}@example.com`, status: "ACTIVE" },
    workspaceId,
    workspace: { id: workspaceId, name: "Lock Test WS", slug: `slug-${workspaceId}` },
    membership: { id: `mem_${userId}`, role, userId, workspaceId, status: "ACTIVE" },
  });

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Create Workspaces
    await prisma.workspace.createMany({
      data: [
        { id: ws1Id, name: "Lock WS 1", slug: `lock-ws1-${testRunId}` },
        { id: ws2Id, name: "Lock WS 2", slug: `lock-ws2-${testRunId}` },
      ],
    });

    // 2. Create Users & Memberships
    await prisma.user.createMany({
      data: [
        { id: ownerUserId, email: `owner_${testRunId}@example.com`, name: "Owner User", status: "ACTIVE" },
        { id: adminUserId, email: `admin_${testRunId}@example.com`, name: "Admin User", status: "ACTIVE" },
      ],
    });

    await prisma.workspaceMember.createMany({
      data: [
        { id: `mem_owner_${testRunId}`, workspaceId: ws1Id, userId: ownerUserId, role: MembershipRole.OWNER, status: "ACTIVE" },
        { id: `mem_admin_${testRunId}`, workspaceId: ws1Id, userId: adminUserId, role: MembershipRole.ADMIN, status: "ACTIVE" },
        { id: `mem_owner2_${testRunId}`, workspaceId: ws2Id, userId: ownerUserId, role: MembershipRole.OWNER, status: "ACTIVE" },
      ],
    });

    // 3. Seed Entitlements
    await prisma.workspaceEntitlementOverride.createMany({
      data: [
        {
          workspaceId: ws1Id,
          featureKey: "FEATURE_AUTOMATIONS",
          featureType: FeatureValueType.BOOLEAN,
          overrideValueJson: true,
          reason: "Phase 1.16.10 Lock Suite",
          grantedByUserId: ownerUserId,
        },
        {
          workspaceId: ws2Id,
          featureKey: "FEATURE_AUTOMATIONS",
          featureType: FeatureValueType.BOOLEAN,
          overrideValueJson: true,
          reason: "Phase 1.16.10 Lock Suite",
          grantedByUserId: ownerUserId,
        },
      ],
    });
  });

  beforeEach(() => {
    clearIngestionDedupeCache();
    hoistedMocks.auth.mockReset();
    hoistedMocks.auth.mockResolvedValue({
      user: { id: ownerUserId, email: `owner_${testRunId}@example.com`, role: MembershipRole.OWNER },
    });

    vi.spyOn(workOrderService, "updateWorkOrder").mockResolvedValue({
      id: "wo_mock_updated",
      internalNotes: "Updated by lock test",
    } as any);

    vi.spyOn(notificationService, "emitNotificationEvent").mockResolvedValue({
      id: "outbox_mock_lock",
      workspaceId: ws1Id,
      status: "PENDING",
    } as any);
  });

  afterAll(async () => {
    clearIngestionDedupeCache();
    if (prisma) {
      await prisma.workspace.deleteMany({
        where: { id: { in: [ws1Id, ws2Id] } },
      }).catch(() => {});
      await prisma.user.deleteMany({
        where: { id: { in: [ownerUserId, adminUserId] } },
      }).catch(() => {});
      await prisma.$disconnect();
    }
  });

  // =========================================================================
  // 1. Cross-Subsystem Concurrency Race: Schedule Worker + Manual Run + DLQ Replay
  // =========================================================================
  describe("1. Cross-Subsystem Concurrency Race (Schedule Worker + Manual Run + DLQ Replay)", () => {
    it("should process concurrent schedule tick, manual test-run, and DLQ replay targeting the same rule without race conditions", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, ws1Id);

      // 1. Create a common active rule
      const rule = await createAutomationRule(
        ws1Id,
        {
          name: "Tri-Subsystem Race Rule",
          isEnabled: true,
          trigger: {
            triggerType: AutomationTriggerType.SCHEDULED_INTERVAL,
            eventType: "schedule.interval",
            configJson: { intervalMinutes: 15 },
          },
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.WORK_ORDER_ADD_NOTE,
              paramsJson: { workOrderId: "wo_tri_test", note: "Tri-subsystem race note" },
            },
          ],
        },
        undefined,
        prisma,
      );

      // 2. Register due schedule job for the rule
      const pastTime = new Date(Date.now() - 60000);
      const scheduleJob = await registerScheduleJob(
        ws1Id,
        {
          ruleId: rule.id,
          scheduleKind: "SCHEDULED_INTERVAL",
          intervalSeconds: 900,
        },
        prisma,
      );
      await prisma.automationScheduleJob.update({
        where: { id: scheduleJob.id },
        data: { nextRunAt: pastTime },
      });

      // 3. Create existing failed DLQ execution for the rule
      const dlqExecution = await prisma.automationExecution.create({
        data: {
          workspaceId: ws1Id,
          ruleId: rule.id,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: `corr_tri_dlq_${Date.now()}`,
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: { source: "dlq_initial" },
          errorJson: {
            code: "RETRIES_EXHAUSTED",
            attempts: 3,
            failedStepOrder: 1,
            failedActionType: "WORK_ORDER_ADD_NOTE",
          },
        },
      });

      // 4. Fire all 3 subsystems concurrently in parallel
      const [scheduleResults, testRunResult, replayResult] = await Promise.all([
        pollAndDispatchDueScheduleJobs(ws1Id, { now: new Date(), maxJobsPerPoll: 10 }, prisma),
        testRunAutomationRule(ws1Id, rule.id, { payload: { source: "manual_tri_race" } }, auth as any, prisma),
        replayDeadLetterExecution(ws1Id, dlqExecution.id, auth as any, prisma),
      ]);

      // 5. Assertions on Schedule Job Worker outcome
      expect(scheduleResults.jobsChecked).toBe(1);
      expect(scheduleResults.jobsDispatched).toBe(1);
      expect(scheduleResults.results[0].status).toBe("DISPATCHED");
      expect(scheduleResults.results[0].executionId).toBeDefined();

      // 6. Assertions on Manual Test Run outcome
      expect(testRunResult.success).toBe(true);
      expect(testRunResult.results[0].status).toBe(AutomationExecutionStatus.COMPLETED);
      expect(testRunResult.results[0].executionId).toBeDefined();

      // 7. Assertions on DLQ Replay outcome
      expect(replayResult.status).toBe(AutomationExecutionStatus.COMPLETED);
      expect(replayResult.originalExecutionId).toBe(dlqExecution.id);
      expect(replayResult.replayExecutionId).toBeDefined();

      // 8. Verify all 3 produced distinct execution IDs without conflict
      const execIds = [
        scheduleResults.results[0].executionId!,
        testRunResult.results[0].executionId,
        replayResult.replayExecutionId,
      ];
      const uniqueExecIds = new Set(execIds);
      expect(uniqueExecIds.size).toBe(3);

      // 9. Verify all 3 completed executions exist in database with full step records
      const persistedExecs = await prisma.automationExecution.findMany({
        where: {
          id: { in: execIds },
          workspaceId: ws1Id,
        },
        include: { steps: true },
      });

      expect(persistedExecs).toHaveLength(3);
      for (const exec of persistedExecs) {
        expect(exec.status).toBe(AutomationExecutionStatus.COMPLETED);
        expect(exec.steps).toHaveLength(1);
        expect(exec.steps[0].status).toBe(AutomationExecutionStepStatus.COMPLETED);
      }
    });
  });

  // =========================================================================
  // 2. Concurrent Rule Mutations Racing In-Flight Pipeline Execution
  // =========================================================================
  describe("2. Concurrent Rule Mutation Racing In-Flight Pipeline Execution", () => {
    it("should execute in-flight execution to completion using acquired rule snapshot while subsequent runs observe modified rule", async () => {
      const auth = createAuthContext(adminUserId, MembershipRole.ADMIN, ws1Id);

      // 1. Create active rule with 2 sequential actions and a trigger
      const rule = await createAutomationRule(
        ws1Id,
        {
          name: "Concurrent Mutation Rule",
          isEnabled: true,
          trigger: {
            triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
            eventType: "work_order.completed",
          },
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.WORK_ORDER_ADD_NOTE,
              paramsJson: { workOrderId: "wo_mut_1", note: "Step 1 note" },
            },
            {
              stepOrder: 2,
              actionType: AutomationActionType.NOTIFICATION_SEND_IN_APP,
              paramsJson: { message: "Step 2 alert" },
            },
          ],
        },
        undefined,
        prisma,
      );

      // 2. Create pending execution record
      const inFlightExec = await prisma.automationExecution.create({
        data: {
          workspaceId: ws1Id,
          ruleId: rule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_inflight_${Date.now()}`,
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: { woId: "wo_mut_1" },
        },
      });

      // 3. Concurrently run the in-flight pipeline AND mutate the rule (disable and replace actions)
      const [pipelineResult, updatedRule] = await Promise.all([
        executeAutomationPipeline(ws1Id, inFlightExec.id, undefined, prisma),
        updateAutomationRule(
          ws1Id,
          rule.id,
          {
            name: "Mutated Disabled Rule",
            isEnabled: false, // Disabled mid-flight
            actions: [
              {
                stepOrder: 1,
                actionType: AutomationActionType.CUSTOMER_UPDATE_STATUS,
                paramsJson: { customerId: "cust_mut_new", status: "VIP" },
              },
            ],
          },
          undefined,
          prisma,
        ),
      ]);

      // 4. In-flight execution completed both original steps successfully
      expect(pipelineResult.status).toBe(AutomationExecutionStatus.COMPLETED);
      expect(pipelineResult.stepCount).toBe(2);

      // 5. Updated rule is disabled with 1 replaced action
      expect(updatedRule.isEnabled).toBe(false);
      expect(updatedRule.actions).toHaveLength(1);
      expect(updatedRule.actions[0].actionType).toBe(AutomationActionType.CUSTOMER_UPDATE_STATUS);

      // 6. Ingesting a subsequent event for the updated rule is SKIPPED with RULE_DISABLED
      const subsequentIngest = await ingestAutomationEvent(
        ws1Id,
        {
          workspaceId: ws1Id,
          eventType: AutomationTriggerType.WORK_ORDER_COMPLETED,
          sourceEntity: "WorkOrder",
          sourceId: "wo_subsequent_test",
          payload: { woId: "wo_subsequent_test" },
        },
        prisma,
      );
      expect(subsequentIngest.outcome).toBe("SKIPPED");
      expect(subsequentIngest.reasonCode).toBe("RULE_DISABLED");
    });
  });

  // =========================================================================
  // 3. Concurrent Step Retry Loop Racing Asynchronous DLQ Purge
  // =========================================================================
  describe("3. Concurrent Step Retry Loop Racing DLQ Purge", () => {
    it("should safely resolve concurrent retry execution and administrative purge without unhandled lock contention", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, ws1Id);

      // Create a DLQ execution
      const dlqExec = await prisma.automationExecution.create({
        data: {
          workspaceId: ws1Id,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: `corr_race_purge_${Date.now()}`,
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: { test: true },
          errorJson: {
            code: "P1001",
            message: "Transient error in retry loop",
            attempts: 2,
          },
        },
      });

      const retryContext: ActionExecutionContext = {
        workspaceId: ws1Id,
        executionId: dlqExec.id,
        correlationId: dlqExec.correlationId,
        stepOrder: 1,
        causalityChain: [],
        executionDepth: 0,
        trigger: {
          id: "trig_purge_race",
          triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
          eventType: "work_order.completed",
          sourceEntity: "WorkOrder",
          sourceId: "wo_purge_race",
          payload: {},
        },
        stepOutputs: {},
        steps: {},
      };

      let attempt = 0;
      const retryPromise = executeStepWithRetry(
        async () => {
          attempt++;
          if (attempt === 1) {
            throw { code: "P1001", message: "Transient db failure during concurrent retry" };
          }
          return { success: true, data: { status: "recovered" }, idempotencyKey: "idem_purge_race_1" };
        },
        retryContext,
        {
          maxRetries: 3,
          baseDelayMs: 20,
          maxJitterMs: 0,
        },
      );

      // Concurrently purge the DLQ record
      const purgePromise = purgeDeadLetterExecution(ws1Id, dlqExec.id, auth as any, prisma);

      const [retryOutcome, purgeOutcome] = await Promise.all([retryPromise, purgePromise]);

      expect(retryOutcome.result.success).toBe(true);
      expect(retryOutcome.attemptCount).toBe(2);
      expect(purgeOutcome.success).toBe(true);
      expect(purgeOutcome.purgedExecutionId).toBe(dlqExec.id);

      // Verify immutable audit: execution still exists in DB with isPurged: true
      const auditedExec = await prisma.automationExecution.findUniqueOrThrow({
        where: { id: dlqExec.id },
      });
      const errJson = auditedExec.errorJson as any;
      expect(errJson.isPurged).toBe(true);
      expect(errJson.purgedBy).toBe(ownerUserId);
    });
  });

  // =========================================================================
  // 4. High-Concurrency Ingestion Thundering Herd with Deduplication
  // =========================================================================
  describe("4. High-Concurrency Ingestion Thundering Herd with Deduplication", () => {
    it("should drop 9 duplicate events when 10 identical events arrive simultaneously across parallel workers", async () => {
      const entityId = `wo_thundering_${Date.now()}`;

      // Create matched rule for event
      await createAutomationRule(
        ws1Id,
        {
          name: "Thundering Herd Rule",
          isEnabled: true,
          trigger: {
            triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
            eventType: "work_order.completed",
          },
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.WORK_ORDER_ADD_NOTE,
              paramsJson: { workOrderId: entityId, note: "Thundering note" },
            },
          ],
        },
        undefined,
        prisma,
      );

      // Fire 10 identical events simultaneously with identical timestamp
      const eventTimestamp = new Date("2026-08-28T12:00:00.000Z");
      const ingestionPromises = Array.from({ length: 10 }).map((_, i) =>
        ingestAutomationEvent(
          ws1Id,
          {
            workspaceId: ws1Id,
            eventType: AutomationTriggerType.WORK_ORDER_COMPLETED,
            sourceEntity: "WorkOrder",
            sourceId: entityId,
            payload: { workOrderId: entityId, status: "COMPLETED" },
            eventTimestamp,
            correlationId: `corr_thundering_${i}`,
          },
          prisma,
        ),
      );

      const results = await Promise.all(ingestionPromises);

      // Exactly 1 must be MATCHED, 9 must be DROPPED_DUPLICATE
      const matched = results.filter((r) => r.outcome === "MATCHED");
      const dropped = results.filter((r) => r.outcome === "DROPPED_DUPLICATE");

      expect(matched).toHaveLength(1);
      expect(dropped).toHaveLength(9);
      expect(matched[0].isDuplicate).toBe(false);
      expect(matched[0].createdExecutionIds).toHaveLength(1);

      for (const d of dropped) {
        expect(d.isDuplicate).toBe(true);
        expect(d.createdExecutionIds).toHaveLength(0);
      }

      // Verify in DB that only 1 execution was created
      const dbExecutions = await prisma.automationExecution.findMany({
        where: {
          workspaceId: ws1Id,
          id: { in: matched[0].createdExecutionIds },
        },
      });
      expect(dbExecutions).toHaveLength(1);
    });
  });

  // =========================================================================
  // 5. Multi-Tenant Concurrency Fortress (Cross-Tenant Concurrent Stress)
  // =========================================================================
  describe("5. Multi-Tenant Concurrency Fortress (Cross-Tenant Concurrent Stress)", () => {
    it("should execute identical automation rules concurrently across 2 workspaces with strict isolation", async () => {
      // 1. Create rule in Workspace 1
      const ruleWs1 = await createAutomationRule(
        ws1Id,
        {
          name: "Tenant Isolation Test Rule",
          isEnabled: true,
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.WORK_ORDER_ADD_NOTE,
              paramsJson: { workOrderId: "wo_ws1_iso", note: "Note for WS 1" },
            },
          ],
        },
        undefined,
        prisma,
      );

      // 2. Create rule in Workspace 2 (same name, distinct workspace)
      const ruleWs2 = await createAutomationRule(
        ws2Id,
        {
          name: "Tenant Isolation Test Rule",
          isEnabled: true,
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.WORK_ORDER_ADD_NOTE,
              paramsJson: { workOrderId: "wo_ws2_iso", note: "Note for WS 2" },
            },
          ],
        },
        undefined,
        prisma,
      );

      // 3. Create execution in each workspace
      const [execWs1, execWs2] = await Promise.all([
        prisma.automationExecution.create({
          data: {
            workspaceId: ws1Id,
            ruleId: ruleWs1.id,
            status: AutomationExecutionStatus.PENDING,
            correlationId: `corr_iso_ws1_${Date.now()}`,
            causalityChain: [],
            executionDepth: 0,
            triggerPayloadJson: { tenant: "WS1" },
          },
        }),
        prisma.automationExecution.create({
          data: {
            workspaceId: ws2Id,
            ruleId: ruleWs2.id,
            status: AutomationExecutionStatus.PENDING,
            correlationId: `corr_iso_ws2_${Date.now()}`,
            causalityChain: [],
            executionDepth: 0,
            triggerPayloadJson: { tenant: "WS2" },
          },
        }),
      ]);

      // 4. Run both pipelines concurrently
      const [resWs1, resWs2] = await Promise.all([
        executeAutomationPipeline(ws1Id, execWs1.id, undefined, prisma),
        executeAutomationPipeline(ws2Id, execWs2.id, undefined, prisma),
      ]);

      expect(resWs1.status).toBe(AutomationExecutionStatus.COMPLETED);
      expect(resWs1.workspaceId).toBe(ws1Id);
      expect(resWs2.status).toBe(AutomationExecutionStatus.COMPLETED);
      expect(resWs2.workspaceId).toBe(ws2Id);

      // 5. Assert WS 1 query never returns WS 2 execution
      const ws1Executions = await prisma.automationExecution.findMany({
        where: { workspaceId: ws1Id },
      });
      expect(ws1Executions.find((e) => e.id === execWs2.id)).toBeUndefined();

      const ws2Executions = await prisma.automationExecution.findMany({
        where: { workspaceId: ws2Id },
      });
      expect(ws2Executions.find((e) => e.id === execWs1.id)).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. Cascading Causality Chain Concurrency with Recursion Depth Guards
  // =========================================================================
  describe("6. Cascading Causality Chain Concurrency with Recursion Depth Guards", () => {
    it("should concurrently enforce recursion cycle and max depth ceilings across parallel causality chains", async () => {
      // 1. Parallel execution at depth 3 (within limit) -> passes
      const validDepthExec = await prisma.automationExecution.create({
        data: {
          workspaceId: ws1Id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_depth_valid_${Date.now()}`,
          causalityChain: ["rule_hop_1", "rule_hop_2", "rule_hop_3"],
          executionDepth: 3, // Exactly at max ceiling
          triggerPayloadJson: {},
        },
      });

      // 2. Parallel execution at depth 4 (exceeds limit D_max = 3) -> fails
      const exceededDepthExec = await prisma.automationExecution.create({
        data: {
          workspaceId: ws1Id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_depth_exceeded_${Date.now()}`,
          causalityChain: ["rule_hop_1", "rule_hop_2", "rule_hop_3", "rule_hop_4"],
          executionDepth: 4, // Exceeds ceiling
          triggerPayloadJson: {},
        },
      });

      // 3. Parallel execution with cyclic causality chain -> fails
      const cyclicRule = await createAutomationRule(
        ws1Id,
        { name: "Cyclic Test Rule", isEnabled: true },
        undefined,
        prisma,
      );
      const cyclicExec = await prisma.automationExecution.create({
        data: {
          workspaceId: ws1Id,
          ruleId: cyclicRule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_cycle_${Date.now()}`,
          causalityChain: ["rule_alpha", cyclicRule.id, "rule_beta"], // cycle on cyclicRule.id
          executionDepth: 2,
          triggerPayloadJson: {},
        },
      });

      // Execute all 3 concurrently
      const [resValid, resExceeded, resCyclic] = await Promise.all([
        executeAutomationPipeline(ws1Id, validDepthExec.id, undefined, prisma),
        executeAutomationPipeline(ws1Id, exceededDepthExec.id, undefined, prisma),
        executeAutomationPipeline(ws1Id, cyclicExec.id, undefined, prisma),
      ]);

      expect(resValid.status).toBe(AutomationExecutionStatus.COMPLETED);
      expect(resExceeded.status).toBe(AutomationExecutionStatus.FAILED);
      expect(resExceeded.reasonCode).toBe("MAX_EXECUTION_DEPTH_EXCEEDED");
      expect(resCyclic.status).toBe(AutomationExecutionStatus.FAILED);
      expect(resCyclic.reasonCode).toBe("RECURSIVE_CYCLE_DETECTED");
    });
  });
});
