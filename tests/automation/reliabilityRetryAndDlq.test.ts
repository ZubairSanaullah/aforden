/**
 * Phase 1.16.9 — Reliability, Retry Engine & Dead Letter Queue (DLQ) Integration Tests
 *
 * Verifies:
 * 1. Error classification taxonomy (transient vs permanent vs fatal).
 * 2. Exponential backoff and jitter calculations per Invariant 7.4.
 * 3. Step-level automatic retry on transient failures and downstream idempotency contract.
 * 4. Permanent failure fatal short-circuit (0 retries).
 * 5. Retries exhaustion leading to Dead Letter Queue registration.
 * 6. DLQ inspection, diagnostics retrieval, purge, and replay pipeline re-entry.
 * 7. Tenant isolation (Invariant 1) and RBAC role boundaries (Invariant 2).
 * 8. Carried-forward item 1 (1.16.6): CANCELED execution terminal guard.
 * 9. Carried-forward item 2 (1.16.3): Database-backed distributed Tier 1 deduplication.
 * 10. DLQ REST API route handlers.
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
  AutomationExecutionStatus,
  AutomationExecutionStepStatus,
  AutomationErrorPolicy,
  AutomationActionType,
  AutomationTriggerType,
  FeatureValueType,
  MembershipRole,
} from "@/generated/prisma/enums";
import {
  classifyAutomationError,
  isTransientError,
  AutomationErrorCategory,
} from "@/lib/services/automation/errorClassifier";
import {
  calculateAutomationBackoff,
  executeStepWithRetry,
} from "@/lib/services/automation/retryEngine";
import {
  listDeadLetterExecutions,
  getDeadLetterExecution,
  replayDeadLetterExecution,
  purgeDeadLetterExecution,
} from "@/lib/services/automation/deadLetterQueueService";
import {
  executeAutomationPipeline,
} from "@/lib/services/automation/executionEngineService";
import {
  createAutomationRule,
} from "@/lib/services/automation/automationManagementService";
import {
  checkAndRecordIngestionDedupeAsync,
  clearIngestionDedupeCache,
} from "@/lib/services/automation/ingestionDeduplication";
import {
  AutomationExecutionAlreadyTerminalError,
  AutomationExecutionNotFoundError,
  AutomationAuthorizationError,
  AutomationValidationError,
} from "@/lib/services/automation/automationErrors";
import { executeAction } from "@/lib/services/automation/actionRegistry";
import { emitNotificationEvent as realEmitNotificationEvent } from "@/lib/services/notification/eventIngestionService";
import type { ActionExecutionContext, ActionResult } from "@/lib/services/automation/automation.types";
import * as workOrderService from "@/lib/services/workOrder";
import * as notificationService from "@/lib/services/notification";

import { GET as dlqListGet } from "@/app/api/automations/dlq/route";
import {
  GET as dlqDetailGet,
  DELETE as dlqDetailDelete,
} from "@/app/api/automations/dlq/[executionId]/route";
import { POST as dlqReplayPost } from "@/app/api/automations/dlq/[executionId]/replay/route";

describe("Phase 1.16.9 — Reliability, Retry Engine & Dead Letter Queue (DLQ)", { timeout: 30000 }, () => {
  let prisma: PrismaClient;
  const testRunId = `dlq_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_dlq_${testRunId}`;
  const otherWsId = `ws_other_${testRunId}`;

  // User contexts
  const ownerUserId = `user_owner_${testRunId}`;
  const adminUserId = `user_admin_${testRunId}`;
  const managerUserId = `user_manager_${testRunId}`;
  const techUserId = `user_tech_${testRunId}`;

  const createAuthContext = (userId: string, role: MembershipRole, workspaceId: string) => ({
    userId,
    user: { id: userId, name: `User ${userId}`, email: `${userId}@example.com`, status: "ACTIVE" },
    workspaceId,
    workspace: { id: workspaceId, name: "Test WS", slug: `slug-${workspaceId}` },
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
        { id: wsId, name: "Automation DLQ WS", slug: `dlq-main-${testRunId}` },
        { id: otherWsId, name: "Other DLQ WS", slug: `dlq-other-${testRunId}` },
      ],
    });

    // 2. Create Users
    await prisma.user.createMany({
      data: [
        { id: ownerUserId, email: `owner_${testRunId}@example.com`, name: "Owner User", status: "ACTIVE" },
        { id: adminUserId, email: `admin_${testRunId}@example.com`, name: "Admin User", status: "ACTIVE" },
        { id: managerUserId, email: `manager_${testRunId}@example.com`, name: "Manager User", status: "ACTIVE" },
        { id: techUserId, email: `tech_${testRunId}@example.com`, name: "Tech User", status: "ACTIVE" },
      ],
    });

    // 3. Create Workspace Members
    await prisma.workspaceMember.createMany({
      data: [
        { id: `mem_owner_${testRunId}`, workspaceId: wsId, userId: ownerUserId, role: MembershipRole.OWNER, status: "ACTIVE" },
        { id: `mem_admin_${testRunId}`, workspaceId: wsId, userId: adminUserId, role: MembershipRole.ADMIN, status: "ACTIVE" },
        { id: `mem_mgr_${testRunId}`, workspaceId: wsId, userId: managerUserId, role: MembershipRole.MANAGER, status: "ACTIVE" },
        { id: `mem_tech_${testRunId}`, workspaceId: wsId, userId: techUserId, role: MembershipRole.TECHNICIAN, status: "ACTIVE" },
      ],
    });

    // 4. Seed Entitlements
    await prisma.workspaceEntitlementOverride.createMany({
      data: [
        {
          workspaceId: wsId,
          featureKey: "FEATURE_AUTOMATIONS",
          featureType: FeatureValueType.BOOLEAN,
          overrideValueJson: true,
          reason: "DLQ test suite entitlement",
          grantedByUserId: ownerUserId,
        },
        {
          workspaceId: otherWsId,
          featureKey: "FEATURE_AUTOMATIONS",
          featureType: FeatureValueType.BOOLEAN,
          overrideValueJson: true,
          reason: "DLQ test suite other entitlement",
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

    vi.spyOn(notificationService, "emitNotificationEvent").mockResolvedValue({
      id: "outbox_mock_123",
      workspaceId: wsId,
      status: "PENDING",
    } as any);
  });

  afterAll(async () => {
    clearIngestionDedupeCache();
    if (prisma) {
      await prisma.workspace.deleteMany({
        where: { id: { in: [wsId, otherWsId] } },
      }).catch(() => {});
      await prisma.user.deleteMany({
        where: { id: { in: [ownerUserId, adminUserId, managerUserId, techUserId] } },
      }).catch(() => {});
      await prisma.$disconnect();
    }
  });

  // =========================================================================
  // 1. Error Classification Engine
  // =========================================================================
  describe("1. Error Classification & Taxonomy (Invariants 6 & 7)", () => {
    it("should classify infrastructure, network, deadlock, and timeout errors as TRANSIENT (retryable)", () => {
      const transientErrors = [
        { code: "P1001", message: "Can't reach database server" },
        { code: "P2028", message: "Transaction timeout" },
        { code: "P2034", message: "Write conflict or deadlock" },
        { code: "ECONNRESET", message: "Connection reset by peer" },
        { code: "ETIMEDOUT", message: "Socket timeout" },
        { code: "GATEWAY_TIMEOUT", message: "Gateway timed out", statusCode: 504 },
        { code: "RATE_LIMITED", message: "Too many requests", statusCode: 429 },
        new Error("Database connection lost during query"),
        new Error("Lock contention detected on row"),
      ];

      for (const err of transientErrors) {
        const classified = classifyAutomationError(err);
        expect(classified.category).toBe(AutomationErrorCategory.TRANSIENT);
        expect(classified.isRetryable).toBe(true);
        expect(isTransientError(err)).toBe(true);
      }
    });

    it("should classify business logic, validation, 4xx, and not found errors as PERMANENT (never retry)", () => {
      const permanentErrors = [
        new AutomationValidationError("Invalid step input params"),
        { code: "VALIDATION_ERROR", message: "WorkOrder validation failed", statusCode: 400 },
        { code: "WORK_ORDER_NOT_FOUND", message: "Work order not found", statusCode: 404 },
        { code: "QUOTA_EXCEEDED", message: "Plan quota limit reached", statusCode: 403 },
        { code: "INVALID_STATUS_TRANSITION", message: "Cannot transition from DRAFT to COMPLETED", statusCode: 422 },
        { code: "P2002", message: "Unique constraint failed on field name" },
        { code: "P2003", message: "Foreign key constraint failed" },
      ];

      for (const err of permanentErrors) {
        const classified = classifyAutomationError(err);
        expect(classified.category).toBe(AutomationErrorCategory.PERMANENT);
        expect(classified.isRetryable).toBe(false);
        expect(isTransientError(err)).toBe(false);
      }
    });

    it("should classify recursion cycle and execution depth violations as FATAL (never retry)", () => {
      const fatalErrors = [
        { code: "MAX_EXECUTION_DEPTH_EXCEEDED", message: "Execution depth 4 exceeds maximum ceiling 3" },
        { code: "RECURSIVE_CYCLE_DETECTED", message: "Rule rule_123 already executed in causality chain" },
      ];

      for (const err of fatalErrors) {
        const classified = classifyAutomationError(err);
        expect(classified.category).toBe(AutomationErrorCategory.FATAL);
        expect(classified.isRetryable).toBe(false);
        expect(isTransientError(err)).toBe(false);
      }
    });
  });

  // =========================================================================
  // 2. Exponential Backoff & Jitter Engine
  // =========================================================================
  describe("2. Exponential Backoff & Jitter Engine (Invariant 7.4)", () => {
    it("should compute deterministic exponential backoff delays with bounded jitter", () => {
      const config = {
        baseDelayMs: 1000,
        multiplier: 2,
        maxDelayMs: 10000,
        maxJitterMs: 200,
      };

      // Attempt 1: 1000 * 2^0 = 1000ms (+ 0..200 jitter) -> 1000..1200
      const delay1 = calculateAutomationBackoff(1, config);
      expect(delay1).toBeGreaterThanOrEqual(1000);
      expect(delay1).toBeLessThanOrEqual(1200);

      // Attempt 2: 1000 * 2^1 = 2000ms (+ 0..200 jitter) -> 2000..2200
      const delay2 = calculateAutomationBackoff(2, config);
      expect(delay2).toBeGreaterThanOrEqual(2000);
      expect(delay2).toBeLessThanOrEqual(2200);

      // Attempt 3: 1000 * 2^2 = 4000ms (+ 0..200 jitter) -> 4000..4200
      const delay3 = calculateAutomationBackoff(3, config);
      expect(delay3).toBeGreaterThanOrEqual(4000);
      expect(delay3).toBeLessThanOrEqual(4200);

      // Attempt 5: 1000 * 2^4 = 16000ms -> capped at maxDelayMs 10000 (+ 0..200 jitter) -> 10000..10200
      const delay5 = calculateAutomationBackoff(5, config);
      expect(delay5).toBeGreaterThanOrEqual(10000);
      expect(delay5).toBeLessThanOrEqual(10200);
    });

    it("should handle 0 jitter cleanly when configured", () => {
      const config = {
        baseDelayMs: 500,
        multiplier: 3,
        maxDelayMs: 5000,
        maxJitterMs: 0,
      };

      expect(calculateAutomationBackoff(1, config)).toBe(500);
      expect(calculateAutomationBackoff(2, config)).toBe(1500);
      expect(calculateAutomationBackoff(3, config)).toBe(4500);
    });
  });

  // =========================================================================
  // 3. Step-Level Retry Loop & Downstream Idempotency Contract
  // =========================================================================
  describe("3. Step-Level Retry Loop & Idempotency Contract (Invariants 5, 7)", () => {
    it("should automatically retry transient failure and succeed on subsequent attempt without duplicating side effects", async () => {
      let callCount = 0;

      const mockHandler = async () => {
        callCount++;
        if (callCount === 1) {
          throw { code: "P1001", message: "Transient database connection error" };
        }
        return {
          success: true,
          data: { invoiceId: "inv_recovered_123" },
          idempotencyKey: "idem_test_key_step_1",
        };
      };

      const dummyContext: ActionExecutionContext = {
        workspaceId: wsId,
        executionId: "exec_retry_1",
        correlationId: "corr_retry_1",
        stepOrder: 1,
        causalityChain: [],
        executionDepth: 0,
        trigger: {
          id: "trig_1",
          triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
          eventType: "work_order.completed",
          sourceEntity: "WorkOrder",
          sourceId: "wo_1",
          payload: { workOrderId: "wo_1" },
        },
        stepOutputs: {},
        steps: {},
      };

      const delayCalls: number[] = [];
      const retryOutcome = await executeStepWithRetry(
        mockHandler,
        dummyContext,
        {
          maxRetries: 3,
          baseDelayMs: 10,
          maxJitterMs: 0,
          delayFn: async (ms) => {
            delayCalls.push(ms);
          },
        },
      );

      expect(retryOutcome.result.success).toBe(true);
      expect(retryOutcome.attemptCount).toBe(2);
      expect(retryOutcome.retriesExhausted).toBe(false);
      expect(callCount).toBe(2);
      expect(delayCalls).toHaveLength(1);
      expect(delayCalls[0]).toBe(10);
    });

    it("should pass byte-identical idempotency key to downstream domain service across retry attempts and guarantee zero duplicate records in DB", async () => {
      // 1. Unmock notificationService.emitNotificationEvent to execute the real transactional outbox domain service
      vi.spyOn(notificationService, "emitNotificationEvent").mockImplementation(realEmitNotificationEvent);

      const uniqueSourceId = `wo_idem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const actionParams = {
        sourceEntity: "WorkOrder",
        sourceId: uniqueSourceId,
        eventType: "WORK_ORDER_STATUS_CHANGED",
        title: "Downstream Idempotency Test Notification",
        message: "Verifying single database record across transient retry attempts",
        payload: {
          workOrderId: uniqueSourceId,
          workOrderNumber: "WO-9999",
          title: "Downstream Idempotency Test Notification",
          customerId: "cust_idem_123",
          previousStatus: "IN_PROGRESS",
          newStatus: "COMPLETED",
        },
      };

      const retryContext: ActionExecutionContext = {
        workspaceId: wsId,
        executionId: `exec_idem_${Date.now()}`,
        correlationId: `corr_idem_${Date.now()}`,
        stepOrder: 1,
        causalityChain: [],
        executionDepth: 0,
        trigger: {
          id: `trig_${uniqueSourceId}`,
          triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
          eventType: "work_order.completed",
          sourceEntity: "WorkOrder",
          sourceId: uniqueSourceId,
          payload: { workOrderId: uniqueSourceId },
        },
        stepOutputs: {},
        steps: {},
        prismaTx: prisma,
      };

      let attemptCounter = 0;
      const capturedKeys: string[] = [];

      // 2. Execute via retry engine routing through the real Action Registry (executeAction)
      const retryOutcome = await executeStepWithRetry(
        async () => {
          attemptCounter++;
          // Routes through real Action Registry -> NotificationSendInAppActionHandler -> emitNotificationEvent -> DB
          const actionResult = await executeAction(
            AutomationActionType.NOTIFICATION_SEND_IN_APP,
            actionParams,
            retryContext,
          );

          if (actionResult.idempotencyKey) {
            capturedKeys.push(actionResult.idempotencyKey);
          }

          // Simulate transient failure occurring on response path / connection drop right after side effect landed in DB
          if (attemptCounter === 1) {
            throw {
              code: "P1001",
              message: "Transient database socket reset on response acknowledgment path",
            };
          }

          return actionResult;
        },
        retryContext,
        {
          maxRetries: 3,
          baseDelayMs: 10,
          maxJitterMs: 0,
        },
      );

      // 3. Verify retry loop completed successfully on attempt 2
      expect(retryOutcome.result.success).toBe(true);
      expect(retryOutcome.attemptCount).toBe(2);
      expect(retryOutcome.retriesExhausted).toBe(false);
      expect(attemptCounter).toBe(2);

      // 4. Assert idempotency key is byte-identical across both invocations and matches result
      expect(capturedKeys).toHaveLength(2);
      expect(capturedKeys[0]).toBe(capturedKeys[1]); // Byte-identical key across attempt 1 & attempt 2
      expect(capturedKeys[0]).toBe(retryOutcome.result.idempotencyKey);
      expect(typeof capturedKeys[0]).toBe("string");
      expect(capturedKeys[0].length).toBe(64); // SHA-256 hex string

      // 5. Query database directly: verify exactly ONE outbox record exists, proving downstream deduplication
      const outboxRecords = await prisma.notificationOutbox.findMany({
        where: {
          workspaceId: wsId,
          dedupeKey: capturedKeys[0],
        },
      });

      expect(outboxRecords).toHaveLength(1); // Crucial guarantee: zero duplicate side effect rows created
      expect(outboxRecords[0].sourceId).toBe(uniqueSourceId);
      expect(outboxRecords[0].dedupeKey).toBe(capturedKeys[0]);
    });

    it("should fatal short-circuit on permanent error with zero retries", async () => {
      let callCount = 0;
      const mockHandler = async () => {
        callCount++;
        throw new AutomationValidationError("Customer ID is missing from payload");
      };

      const dummyContext: ActionExecutionContext = {
        workspaceId: wsId,
        executionId: "exec_perm_1",
        correlationId: "corr_perm_1",
        stepOrder: 1,
        causalityChain: [],
        executionDepth: 0,
        trigger: {
          id: "trig_1",
          triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
          eventType: "work_order.completed",
          sourceEntity: "WorkOrder",
          sourceId: "wo_1",
          payload: {},
        },
        stepOutputs: {},
        steps: {},
      };

      const delayCalls: number[] = [];
      const retryOutcome = await executeStepWithRetry(
        mockHandler,
        dummyContext,
        {
          maxRetries: 3,
          delayFn: async (ms) => {
            delayCalls.push(ms);
          },
        },
      );

      expect(retryOutcome.result.success).toBe(false);
      expect(retryOutcome.attemptCount).toBe(1); // Aborted after attempt 1
      expect(retryOutcome.retriesExhausted).toBe(false);
      expect(retryOutcome.errorCategory).toBe(AutomationErrorCategory.PERMANENT);
      expect(callCount).toBe(1);
      expect(delayCalls).toHaveLength(0); // Zero backoff delays
    });
  });

  // =========================================================================
  // 4. Exhausted Retries -> Dead Letter Queue
  // =========================================================================
  describe("4. Exhausted Retries -> DLQ Transition & Inspection", () => {
    it("should exhaust max 3 retries on repeated transient error and record DLQ failure state", async () => {
      let updateWorkOrderAttempts = 0;
      vi.spyOn(workOrderService, "updateWorkOrder").mockImplementation(async () => {
        updateWorkOrderAttempts++;
        throw {
          code: "P1001",
          message: "Transient database connection timeout error",
        };
      });

      // Create a test rule with 1 action
      const rule = await createAutomationRule(
        wsId,
        {
          name: "Transient Fail Rule",
          isEnabled: true,
          errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.WORK_ORDER_ADD_NOTE,
              paramsJson: { workOrderId: "wo_dummy_test", note: "Retry Test Note" },
            },
          ],
        },
        undefined,
        prisma,
      );

      // Create an execution record
      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_exhaust_${Date.now()}`,
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: { workOrderId: "wo_dummy_test" },
        },
      });

      // Run pipeline with retryConfig with 0 delay for fast test execution
      const pipelineResult = await executeAutomationPipeline(
        wsId,
        execution.id,
        {
          retryConfig: {
            maxRetries: 3,
            baseDelayMs: 0,
            maxJitterMs: 0,
            delayFn: async () => {},
          },
        },
        prisma,
      );

      expect(pipelineResult.status).toBe(AutomationExecutionStatus.FAILED);
      expect(pipelineResult.reasonCode).toBe("RETRIES_EXHAUSTED");
      expect(updateWorkOrderAttempts).toBe(3);

      // Check execution record in DB
      const updatedExec = await prisma.automationExecution.findUniqueOrThrow({
        where: { id: execution.id },
      });
      expect(updatedExec.status).toBe(AutomationExecutionStatus.FAILED);
      expect(updatedExec.reasonCode).toBe("RETRIES_EXHAUSTED");
      const errJson = updatedExec.errorJson as any;
      expect(errJson.isDeadLetter).toBe(true);
      expect(errJson.attempts).toBe(3);
      expect(errJson.failedStepOrder).toBe(1);
    });

    it("should list Dead Letter Queue items with full failure diagnostic metadata and filtering", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);

      // Create 2 dead letter executions
      await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: "corr_dlq_1",
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: { entity: "invoice_1" },
          errorJson: {
            code: "RETRIES_EXHAUSTED",
            message: "Action execution exhausted all 3 retry attempts",
            category: "TRANSIENT",
            attempts: 3,
            failedStepOrder: 1,
            failedActionType: "INVOICE_CREATE_FROM_WORK_ORDER",
          },
        },
      });

      await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "DOMAIN_SERVICE_ERROR",
          correlationId: "corr_dlq_2",
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: { entity: "invoice_2" },
          errorJson: {
            code: "WORK_ORDER_NOT_FOUND",
            message: "Work order not found",
            category: "PERMANENT",
            attempts: 1,
            failedStepOrder: 1,
            failedActionType: "WORK_ORDER_UPDATE_STATUS",
          },
        },
      });

      const listResult = await listDeadLetterExecutions(wsId, { page: 1, pageSize: 10 }, auth as any, prisma);
      expect(listResult.items.length).toBeGreaterThanOrEqual(2);
      expect(listResult.total).toBeGreaterThanOrEqual(2);

      const retriesExhaustedItem = listResult.items.find((i) => i.reasonCode === "RETRIES_EXHAUSTED");
      expect(retriesExhaustedItem).toBeDefined();
      expect(retriesExhaustedItem?.attemptCount).toBe(3);
      expect(retriesExhaustedItem?.failedActionType).toBe("INVOICE_CREATE_FROM_WORK_ORDER");
    });

    it("should retrieve single DLQ execution with step history", async () => {
      const auth = createAuthContext(adminUserId, MembershipRole.ADMIN, wsId);

      const dlqExec = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: "corr_dlq_detail",
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: { test: true },
          errorJson: {
            code: "RETRIES_EXHAUSTED",
            message: "Exhausted retries",
            category: "TRANSIENT",
            attempts: 3,
            failedStepOrder: 2,
            failedActionType: "NOTIFICATION_SEND_IN_APP",
          },
        },
      });

      const fetched = await getDeadLetterExecution(wsId, dlqExec.id, auth as any, prisma);
      expect(fetched.id).toBe(dlqExec.id);
      expect(fetched.correlationId).toBe("corr_dlq_detail");
      expect(fetched.failedStepOrder).toBe(2);
      expect(fetched.failedActionType).toBe("NOTIFICATION_SEND_IN_APP");
      expect(fetched.attemptCount).toBe(3);
    });

    it("should purge DLQ execution by marking it resolved without deleting immutable history", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);

      const dlqExec = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: "corr_dlq_purge",
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: { test: true },
          errorJson: { code: "RETRIES_EXHAUSTED", attempts: 3 },
        },
      });

      const purgeResult = await purgeDeadLetterExecution(wsId, dlqExec.id, auth as any, prisma);
      expect(purgeResult.success).toBe(true);
      expect(purgeResult.purgedExecutionId).toBe(dlqExec.id);

      // Verify execution still exists in DB (immutable audit) with isPurged: true
      const inDb = await prisma.automationExecution.findUniqueOrThrow({
        where: { id: dlqExec.id },
      });
      expect(inDb).toBeDefined();
      const errJson = inDb.errorJson as any;
      expect(errJson.isPurged).toBe(true);
      expect(errJson.purgedBy).toBe(ownerUserId);
    });
  });

  // =========================================================================
  // 5. DLQ Replay Engine
  // =========================================================================
  describe("5. Dead Letter Queue Replay Engine", () => {
    it("should replay a failed execution and update original DLQ record with replay audit metadata", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);

      // 1. Create a valid rule with Notification action
      const rule = await createAutomationRule(
        wsId,
        {
          name: "Replay Test Rule",
          isEnabled: true,
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.NOTIFICATION_SEND_IN_APP,
              paramsJson: { message: "Replayed notification" },
            },
          ],
        },
        undefined,
        prisma,
      );

      // 2. Create original failed DLQ execution
      const originalDlq = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: "corr_orig_replay",
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: { event: "wo_done" },
          errorJson: {
            code: "RETRIES_EXHAUSTED",
            attempts: 3,
            failedStepOrder: 1,
          },
        },
      });

      // 3. Replay DLQ execution
      const replayResult = await replayDeadLetterExecution(
        wsId,
        originalDlq.id,
        auth as any,
        prisma,
      );

      expect(replayResult.originalExecutionId).toBe(originalDlq.id);
      expect(replayResult.replayExecutionId).toBeDefined();
      expect(replayResult.status).toBe(AutomationExecutionStatus.COMPLETED);

      // 4. Verify original DLQ record updated with replay trace
      const updatedOrig = await prisma.automationExecution.findUniqueOrThrow({
        where: { id: originalDlq.id },
      });
      const errJson = updatedOrig.errorJson as any;
      expect(errJson.replayedAt).toBeDefined();
      expect(errJson.replayExecutionId).toBe(replayResult.replayExecutionId);
      expect(errJson.replayStatus).toBe(AutomationExecutionStatus.COMPLETED);
      expect(errJson.replayCount).toBe(1);
    });

    it("should reject replaying a DLQ execution if parent rule has been deleted", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);

      const dlqNoRule = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: null, // Rule deleted
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: "corr_no_rule",
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: {},
        },
      });

      await expect(
        replayDeadLetterExecution(wsId, dlqNoRule.id, auth as any, prisma),
      ).rejects.toThrow(AutomationValidationError);
    });
  });

  // =========================================================================
  // 6. Tenant Isolation (Invariant 1) & Role Permissions (Invariant 2)
  // =========================================================================
  describe("6. Tenant Isolation & Role Permissions for DLQ", () => {
    it("should enforce tenant isolation (Invariant 1) on DLQ queries", async () => {
      const authWs1 = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);

      // Create DLQ item in Workspace 2
      const ws2Dlq = await prisma.automationExecution.create({
        data: {
          workspaceId: otherWsId, // Different workspace
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: "corr_ws2_dlq",
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: {},
        },
      });

      // Attempt to access WS 2 DLQ from WS 1 context -> 404 Not Found
      await expect(
        getDeadLetterExecution(wsId, ws2Dlq.id, authWs1 as any, prisma),
      ).rejects.toThrow(AutomationExecutionNotFoundError);

      // List DLQ for WS 1 -> should never contain WS 2 item
      const listWs1 = await listDeadLetterExecutions(wsId, {}, authWs1 as any, prisma);
      expect(listWs1.items.find((i) => i.id === ws2Dlq.id)).toBeUndefined();
    });

    it("should enforce RBAC boundaries: TECHNICIAN has zero DLQ access; MANAGER can view only; OWNER/ADMIN can manage/replay", async () => {
      const techAuth = createAuthContext(techUserId, MembershipRole.TECHNICIAN, wsId);
      const mgrAuth = createAuthContext(managerUserId, MembershipRole.MANAGER, wsId);
      const adminAuth = createAuthContext(adminUserId, MembershipRole.ADMIN, wsId);

      const dlqExec = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: "corr_rbac_dlq",
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: {},
        },
      });

      // TECHNICIAN blocked from viewing
      await expect(
        listDeadLetterExecutions(wsId, {}, techAuth as any, prisma),
      ).rejects.toThrow(AutomationAuthorizationError);

      // MANAGER can view
      const mgrList = await listDeadLetterExecutions(wsId, {}, mgrAuth as any, prisma);
      expect(mgrList).toBeDefined();

      // MANAGER blocked from replay / purge
      await expect(
        replayDeadLetterExecution(wsId, dlqExec.id, mgrAuth as any, prisma),
      ).rejects.toThrow(AutomationAuthorizationError);

      await expect(
        purgeDeadLetterExecution(wsId, dlqExec.id, mgrAuth as any, prisma),
      ).rejects.toThrow(AutomationAuthorizationError);

      // ADMIN can purge
      const purgeRes = await purgeDeadLetterExecution(wsId, dlqExec.id, adminAuth as any, prisma);
      expect(purgeRes.success).toBe(true);
    });
  });

  // =========================================================================
  // 7. Carried-Forward Open Items
  // =========================================================================
  describe("7. Carried-Forward Open Items (1.16.6 & 1.16.3)", () => {
    it("Item 1 (1.16.6): should reject re-executing or re-finalizing an execution in CANCELED terminal status", async () => {
      const canceledExec = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          status: AutomationExecutionStatus.CANCELED,
          correlationId: `corr_canc_${Date.now()}`,
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: {},
        },
      });

      await expect(
        executeAutomationPipeline(wsId, canceledExec.id, undefined, prisma),
      ).rejects.toThrow(AutomationExecutionAlreadyTerminalError);
    });

    it("Item 2 (1.16.3): should perform distributed database-backed Tier 1 deduplication across service instances", async () => {
      const dedupeKey = `dedupe_distrib_test_${Date.now()}`;

      // Simulate prior execution written by a different node in the cluster
      await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          dedupeKey,
          status: AutomationExecutionStatus.COMPLETED,
          correlationId: `corr_distrib_${Date.now()}`,
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: {},
        },
      });

      // Clear local in-memory cache to simulate fresh serverless container
      clearIngestionDedupeCache();

      // Check deduplication with async DB check
      const checkResult = await checkAndRecordIngestionDedupeAsync(wsId, dedupeKey, prisma);
      expect(checkResult.isDuplicate).toBe(true);
      expect(checkResult.dedupeKey).toBe(dedupeKey);
    });
  });

  // =========================================================================
  // 8. DLQ REST API Route Handlers
  // =========================================================================
  describe("8. Dead Letter Queue REST API Route Handlers", () => {
    it("GET /api/automations/dlq & GET /api/automations/dlq/[executionId]", async () => {
      const rule = await createAutomationRule(
        wsId,
        { name: "DLQ API Rule", isEnabled: true },
        undefined,
        prisma,
      );

      const dlqExec = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: "corr_api_dlq",
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: { foo: "bar" },
          errorJson: {
            code: "RETRIES_EXHAUSTED",
            attempts: 3,
            failedStepOrder: 1,
            failedActionType: "WORK_ORDER_ADD_NOTE",
          },
        },
      });

      // GET /api/automations/dlq
      const listReq = new Request(`http://localhost:3000/api/automations/dlq?workspaceId=${wsId}&userId=${ownerUserId}`, {
        method: "GET",
        headers: { "x-workspace-id": wsId },
      });
      const listRes = await dlqListGet(listReq);
      expect(listRes.status).toBe(200);
      const listJson = await listRes.json();
      expect(listJson.success).toBe(true);
      expect(listJson.data.items.length).toBeGreaterThanOrEqual(1);

      // GET /api/automations/dlq/[executionId]
      const getReq = new Request(`http://localhost:3000/api/automations/dlq/${dlqExec.id}?workspaceId=${wsId}&userId=${ownerUserId}`, {
        method: "GET",
        headers: { "x-workspace-id": wsId },
      });
      const getRes = await dlqDetailGet(getReq, { params: Promise.resolve({ executionId: dlqExec.id }) });
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json();
      expect(getJson.success).toBe(true);
      expect(getJson.data.id).toBe(dlqExec.id);
      expect(getJson.data.attemptCount).toBe(3);
    });

    it("POST /api/automations/dlq/[executionId]/replay & DELETE /api/automations/dlq/[executionId]", async () => {
      const rule = await createAutomationRule(
        wsId,
        {
          name: "DLQ Replay API Rule",
          isEnabled: true,
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.NOTIFICATION_SEND_IN_APP,
              paramsJson: { message: "API Replay Note" },
            },
          ],
        },
        undefined,
        prisma,
      );

      const dlqExec = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: "RETRIES_EXHAUSTED",
          correlationId: "corr_api_replay",
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: {},
          errorJson: {
            code: "RETRIES_EXHAUSTED",
            attempts: 3,
          },
        },
      });

      // POST /api/automations/dlq/[executionId]/replay
      const replayReq = new Request(`http://localhost:3000/api/automations/dlq/${dlqExec.id}/replay?workspaceId=${wsId}&userId=${ownerUserId}`, {
        method: "POST",
        headers: { "x-workspace-id": wsId },
      });
      const replayRes = await dlqReplayPost(replayReq, { params: Promise.resolve({ executionId: dlqExec.id }) });
      expect(replayRes.status).toBe(200);
      const replayJson = await replayRes.json();
      expect(replayJson.success).toBe(true);
      expect(replayJson.data.replayExecutionId).toBeDefined();
      expect(replayJson.data.status).toBe(AutomationExecutionStatus.COMPLETED);

      // DELETE /api/automations/dlq/[executionId] (Purge)
      const deleteReq = new Request(`http://localhost:3000/api/automations/dlq/${dlqExec.id}?workspaceId=${wsId}&userId=${ownerUserId}`, {
        method: "DELETE",
        headers: { "x-workspace-id": wsId },
      });
      const deleteRes = await dlqDetailDelete(deleteReq, { params: Promise.resolve({ executionId: dlqExec.id }) });
      expect(deleteRes.status).toBe(200);
      const deleteJson = await deleteRes.json();
      expect(deleteJson.success).toBe(true);
      expect(deleteJson.data.purgedExecutionId).toBe(dlqExec.id);
    });
  });
});
