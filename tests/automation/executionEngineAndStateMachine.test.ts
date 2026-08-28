/**
 * Phase 1.16.6 — Core Automation Execution Engine & State Machine Integration Tests
 */

import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const hoistedMocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireWorkspaceAuthorization: vi.fn(),
  assertPermission: vi.fn(),
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
  AutomationErrorPolicy,
  AutomationActionType,
  FeatureValueType,
  WorkOrderStatus,
  WorkOrderPriority,
} from "@/generated/prisma/enums";
import {
  executeAutomationPipeline,
  computeChildExecutionMetadata,
  runAutomationWorkflow,
  AutomationExecutionAlreadyTerminalError,
} from "@/lib/services/automation";

// Import domain services for mocking
import * as workOrderService from "@/lib/services/workOrder";
import * as invoiceService from "@/lib/services/invoice";
import * as notificationService from "@/lib/services/notification";

describe("Phase 1.16.6 — Core Automation Execution Engine & State Machine", () => {
  let prisma: PrismaClient;
  const testRunId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_engine_${testRunId}`;
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
        { id: wsId, name: "Engine Main WS", slug: `engine-main-${testRunId}` },
        { id: otherWsId, name: "Engine Other WS", slug: `engine-other-${testRunId}` },
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
      await prisma.automationExecutionStep.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.automationExecution.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.automationAction.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.automationCondition.deleteMany({
        where: { workspaceId: { in: [wsId, otherWsId] } },
      });
      await prisma.automationConditionGroup.deleteMany({
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
  // 1. PRE-FLIGHT RECURSION & CYCLE GUARDS (INVARIANT 8)
  // =========================================================================
  describe("1. Pre-Flight Recursion & Cycle Guards (Invariant 8)", () => {
    it("should abort with FAILED and MAX_EXECUTION_DEPTH_EXCEEDED when executionDepth > 3 (no steps created)", async () => {
      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Depth Limit Rule",
          isEnabled: true,
          actions: {
            create: [
              {
                workspaceId: wsId,
                stepOrder: 1,
                actionType: AutomationActionType.WORK_ORDER_UPDATE_STATUS,
                paramsJson: { workOrderId: "wo_1", toStatus: "IN_PROGRESS" },
              },
            ],
          },
        },
      });

      // Create execution with executionDepth = 4 (> D_max = 3)
      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_depth_${testRunId}`,
          executionDepth: 4, // Exceeds ceiling
          causalityChain: ["rule_prev_1", "rule_prev_2", "rule_prev_3"],
          triggerPayloadJson: { workOrderId: "wo_1" },
        },
      });

      const result = await executeAutomationPipeline(wsId, execution.id, undefined, prisma);

      expect(result.status).toBe(AutomationExecutionStatus.FAILED);
      expect(result.reasonCode).toBe("MAX_EXECUTION_DEPTH_EXCEEDED");
      expect(result.stepCount).toBe(0);
      expect(result.steps).toHaveLength(0);

      // Verify DB record
      const dbExec = await prisma.automationExecution.findUnique({
        where: { id: execution.id },
        include: { steps: true },
      });
      expect(dbExec?.status).toBe(AutomationExecutionStatus.FAILED);
      expect(dbExec?.reasonCode).toBe("MAX_EXECUTION_DEPTH_EXCEEDED");
      expect(dbExec?.steps).toHaveLength(0); // Zero step records
    });

    it("should abort with FAILED and RECURSIVE_CYCLE_DETECTED when ruleId already exists in causalityChain (no steps created)", async () => {
      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Cycle Detection Rule",
          isEnabled: true,
          actions: {
            create: [
              {
                workspaceId: wsId,
                stepOrder: 1,
                actionType: AutomationActionType.WORK_ORDER_UPDATE_STATUS,
                paramsJson: { workOrderId: "wo_1", toStatus: "IN_PROGRESS" },
              },
            ],
          },
        },
      });

      // Create execution where causalityChain contains this rule's id
      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_cycle_${testRunId}`,
          executionDepth: 2,
          causalityChain: ["rule_other", rule.id], // Cycle!
          triggerPayloadJson: { workOrderId: "wo_1" },
        },
      });

      const result = await executeAutomationPipeline(wsId, execution.id, undefined, prisma);

      expect(result.status).toBe(AutomationExecutionStatus.FAILED);
      expect(result.reasonCode).toBe("RECURSIVE_CYCLE_DETECTED");
      expect(result.stepCount).toBe(0);
      expect(result.steps).toHaveLength(0);

      // Verify DB record
      const dbExec = await prisma.automationExecution.findUnique({
        where: { id: execution.id },
        include: { steps: true },
      });
      expect(dbExec?.status).toBe(AutomationExecutionStatus.FAILED);
      expect(dbExec?.reasonCode).toBe("RECURSIVE_CYCLE_DETECTED");
      expect(dbExec?.steps).toHaveLength(0); // Zero step records
    });

    // =======================================================================
    // Invariant 8 Worked Example Reproduction (Rule A -> B -> C -> A)
    // =======================================================================
    it("Invariant 8 Worked Example Reproduction: Rule A -> B -> C -> A breaks at Hop 4", async () => {
      const ruleA = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Rule A (Invoice Creator)",
          isEnabled: true,
        },
      });
      const ruleB = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Rule B (Note Appender)",
          isEnabled: true,
        },
      });
      const ruleC = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Rule C (Status Completer)",
          isEnabled: true,
        },
      });

      // Hop 0: UI event -> Triggers Rule A (Depth 0, Chain [])
      const hop0Meta = { executionDepth: 0, causalityChain: [] };
      expect(hop0Meta.executionDepth <= 3).toBe(true);

      // Hop 1: Rule A executes -> triggers Rule B
      const hop1Meta = computeChildExecutionMetadata(hop0Meta, ruleA.id);
      expect(hop1Meta.executionDepth).toBe(1);
      expect(hop1Meta.causalityChain).toEqual([ruleA.id]);

      // Hop 2: Rule B executes -> triggers Rule C
      const hop2Meta = computeChildExecutionMetadata(hop1Meta, ruleB.id);
      expect(hop2Meta.executionDepth).toBe(2);
      expect(hop2Meta.causalityChain).toEqual([ruleA.id, ruleB.id]);

      // Hop 3: Rule C executes -> triggers Rule A
      const hop3Meta = computeChildExecutionMetadata(hop2Meta, ruleC.id);
      expect(hop3Meta.executionDepth).toBe(3);
      expect(hop3Meta.causalityChain).toEqual([ruleA.id, ruleB.id, ruleC.id]);

      // Hop 4: Rule A receives event at Depth 4 with causalityChain [ruleA, ruleB, ruleC]
      const hop4Meta = computeChildExecutionMetadata(hop3Meta, ruleA.id);
      expect(hop4Meta.executionDepth).toBe(4);

      // Create execution for Hop 4 in DB and execute
      const hop4Exec = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: ruleA.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_worked_ex_${testRunId}`,
          executionDepth: hop4Meta.executionDepth,
          causalityChain: hop3Meta.causalityChain, // Contains ruleA.id
          triggerPayloadJson: { workOrderId: "wo_cascade" },
        },
      });

      const hop4Result = await executeAutomationPipeline(wsId, hop4Exec.id, undefined, prisma);

      // BLOCKED IMMEDIATELY at Hop 4 per Invariant 8.2 & 8.3
      expect(hop4Result.status).toBe(AutomationExecutionStatus.FAILED);
      expect(
        ["MAX_EXECUTION_DEPTH_EXCEEDED", "RECURSIVE_CYCLE_DETECTED"].includes(
          hop4Result.reasonCode!,
        ),
      ).toBe(true);
      expect(hop4Result.stepCount).toBe(0);
    });
  });

  // =========================================================================
  // 2. SEQUENTIAL ACTION PIPELINE & CONTEXT PROPAGATION (INVARIANT 3)
  // =========================================================================
  describe("2. Sequential Action Pipeline & Context Propagation", () => {
    it("should execute steps sequentially, propagate step 1 output into step 2 input, and finalize COMPLETED", async () => {
      // Mock domain services
      const mockCreatedWorkOrder: any = {
        id: "wo_generated_999",
        workOrderNumber: "WO-2026-999",
        title: "HVAC Urgent",
      };
      const mockAssignedResult: any = {
        id: "wo_generated_999",
        assignedTechnicianId: "tech_star_1",
        status: WorkOrderStatus.ASSIGNED,
      };

      vi.spyOn(workOrderService, "createWorkOrder").mockResolvedValue(mockCreatedWorkOrder);
      const assignSpy = vi.spyOn(workOrderService, "assignWorkOrder").mockResolvedValue(mockAssignedResult);

      // Create Rule with 2 actions
      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Multi-Step Sequential Rule",
          errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
          actions: {
            create: [
              {
                workspaceId: wsId,
                stepOrder: 1,
                actionType: AutomationActionType.WORK_ORDER_CREATE,
                paramsJson: {
                  customerId: "cust_100",
                  locationId: "loc_200",
                  workTypeId: "wt_300",
                  title: "HVAC Urgent",
                  priority: WorkOrderPriority.HIGH,
                },
              },
              {
                workspaceId: wsId,
                stepOrder: 2,
                actionType: AutomationActionType.WORK_ORDER_ASSIGN_TECHNICIAN,
                paramsJson: {
                  workOrderId: "{{steps.1.output.id}}", // References Step 1 output!
                  technicianId: "tech_star_1",
                },
              },
            ],
          },
        },
      });

      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_seq_${testRunId}`,
          executionDepth: 0,
          causalityChain: [],
          triggerPayloadJson: { source: "test_trigger" },
        },
      });

      const result = await executeAutomationPipeline(wsId, execution.id, undefined, prisma);

      expect(result.status).toBe(AutomationExecutionStatus.COMPLETED);
      expect(result.stepCount).toBe(2);
      expect(result.steps[0].status).toBe(AutomationExecutionStepStatus.COMPLETED);
      expect(result.steps[0].outputJson).toEqual(mockCreatedWorkOrder);
      expect(result.steps[1].status).toBe(AutomationExecutionStepStatus.COMPLETED);
      expect(result.steps[1].outputJson).toEqual(mockAssignedResult);

      // Verify Step 2 received the resolved output from Step 1
      expect(assignSpy).toHaveBeenCalledWith(
        wsId,
        "wo_generated_999", // Value from Step 1 output
        { technicianId: "tech_star_1" },
        undefined,
        undefined,
      );

      // Verify DB records
      const dbSteps = await prisma.automationExecutionStep.findMany({
        where: { executionId: execution.id },
        orderBy: { stepOrder: "asc" },
      });
      expect(dbSteps).toHaveLength(2);
      expect(dbSteps[0].status).toBe(AutomationExecutionStepStatus.COMPLETED);
      expect(dbSteps[1].status).toBe(AutomationExecutionStepStatus.COMPLETED);
    });
  });

  // =========================================================================
  // 3. ERROR POLICY ENFORCEMENT (INVARIANT 6: HALT VS CONTINUE)
  // =========================================================================
  describe("3. Error Policy Enforcement (HALT_ON_ERROR vs CONTINUE_ON_ERROR)", () => {
    it("HALT_ON_ERROR: fails at Step 2, halts subsequent steps, and marks Execution FAILED", async () => {
      vi.spyOn(workOrderService, "createWorkOrder").mockResolvedValue({ id: "wo_step1" } as any);
      vi.spyOn(workOrderService, "assignWorkOrder").mockRejectedValue(new Error("Technician not eligible"));
      const noteSpy = vi.spyOn(workOrderService, "updateWorkOrder").mockResolvedValue({ id: "wo_step1" } as any);

      // 3-action rule with HALT_ON_ERROR
      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Halt on Error Rule",
          errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
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
                  title: "Job 1",
                },
              },
              {
                workspaceId: wsId,
                stepOrder: 2,
                actionType: AutomationActionType.WORK_ORDER_ASSIGN_TECHNICIAN,
                paramsJson: {
                  workOrderId: "wo_step1",
                  technicianId: "tech_ineligible",
                },
              },
              {
                workspaceId: wsId,
                stepOrder: 3,
                actionType: AutomationActionType.WORK_ORDER_ADD_NOTE,
                paramsJson: {
                  workOrderId: "wo_step1",
                  note: "Step 3 note",
                },
              },
            ],
          },
        },
      });

      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_halt_${testRunId}`,
          executionDepth: 0,
          causalityChain: [],
          triggerPayloadJson: {},
        },
      });

      const result = await executeAutomationPipeline(wsId, execution.id, undefined, prisma);

      expect(result.status).toBe(AutomationExecutionStatus.FAILED);
      expect(result.stepCount).toBe(2); // Step 3 was never created!
      expect(result.steps[0].status).toBe(AutomationExecutionStepStatus.COMPLETED);
      expect(result.steps[1].status).toBe(AutomationExecutionStepStatus.FAILED);

      expect(noteSpy).not.toHaveBeenCalled();

      const dbSteps = await prisma.automationExecutionStep.findMany({
        where: { executionId: execution.id },
        orderBy: { stepOrder: "asc" },
      });
      expect(dbSteps).toHaveLength(2); // Step 3 does not exist in DB
    });

    it("CONTINUE_ON_ERROR: records Step 2 failure and continues to Step 3, completing Execution", async () => {
      vi.spyOn(workOrderService, "createWorkOrder").mockResolvedValue({ id: "wo_step1" } as any);
      vi.spyOn(workOrderService, "assignWorkOrder").mockRejectedValue(new Error("Technician not eligible"));
      const noteSpy = vi.spyOn(workOrderService, "updateWorkOrder").mockResolvedValue({ id: "wo_step1" } as any);

      // 3-action rule with CONTINUE_ON_ERROR
      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Continue on Error Rule",
          errorPolicy: AutomationErrorPolicy.CONTINUE_ON_ERROR,
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
                  title: "Job 1",
                },
              },
              {
                workspaceId: wsId,
                stepOrder: 2,
                actionType: AutomationActionType.WORK_ORDER_ASSIGN_TECHNICIAN,
                paramsJson: {
                  workOrderId: "wo_step1",
                  technicianId: "tech_ineligible",
                },
              },
              {
                workspaceId: wsId,
                stepOrder: 3,
                actionType: AutomationActionType.WORK_ORDER_ADD_NOTE,
                paramsJson: {
                  workOrderId: "wo_step1",
                  note: "Step 3 note",
                },
              },
            ],
          },
        },
      });

      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_cont_${testRunId}`,
          executionDepth: 0,
          causalityChain: [],
          triggerPayloadJson: {},
        },
      });

      const result = await executeAutomationPipeline(wsId, execution.id, undefined, prisma);

      expect(result.status).toBe(AutomationExecutionStatus.COMPLETED);
      expect(result.stepCount).toBe(3); // All 3 steps executed!
      expect(result.steps[0].status).toBe(AutomationExecutionStepStatus.COMPLETED);
      expect(result.steps[1].status).toBe(AutomationExecutionStepStatus.FAILED);
      expect(result.steps[2].status).toBe(AutomationExecutionStepStatus.COMPLETED);

      expect(noteSpy).toHaveBeenCalledTimes(1);

      const dbSteps = await prisma.automationExecutionStep.findMany({
        where: { executionId: execution.id },
        orderBy: { stepOrder: "asc" },
      });
      expect(dbSteps).toHaveLength(3);
      expect(dbSteps[1].status).toBe(AutomationExecutionStepStatus.FAILED);
      expect(dbSteps[2].status).toBe(AutomationExecutionStepStatus.COMPLETED);
    });
  });

  // =========================================================================
  // 4. TIMEOUT HANDLING (SECTION 2.2 STAGE 6)
  // =========================================================================
  describe("4. Timeout Handling (Section 2.2 Stage 6 & Short-Circuit Matrix)", () => {
    it("should mark step and execution TIMED_OUT when action duration exceeds timeout threshold", async () => {
      // Simulate delayed domain service call
      vi.spyOn(workOrderService, "createWorkOrder").mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ id: "wo_late" } as any), 150)),
      );

      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "Timeout Rule",
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
                  title: "Slow Job",
                },
              },
            ],
          },
        },
      });

      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr_timeout_${testRunId}`,
          executionDepth: 0,
          causalityChain: [],
          triggerPayloadJson: {},
        },
      });

      // Pass small stepTimeoutMs of 40ms to trigger timeout
      const result = await executeAutomationPipeline(
        wsId,
        execution.id,
        { stepTimeoutMs: 40 },
        prisma,
      );

      expect(result.status).toBe(AutomationExecutionStatus.TIMED_OUT);
      expect(result.reasonCode).toBe("EXECUTION_TIMEOUT");
      expect(result.steps[0].status).toBe(AutomationExecutionStepStatus.TIMED_OUT);

      const dbExec = await prisma.automationExecution.findUnique({
        where: { id: execution.id },
        include: { steps: true },
      });
      expect(dbExec?.status).toBe(AutomationExecutionStatus.TIMED_OUT);
      expect(dbExec?.reasonCode).toBe("EXECUTION_TIMEOUT");
      expect(dbExec?.steps[0].status).toBe(AutomationExecutionStepStatus.TIMED_OUT);
    });
  });

  // =========================================================================
  // 5. APPEND-ONLY IMMUTABILITY (INVARIANT 4)
  // =========================================================================
  describe("5. Append-Only Immutability (Invariant 4)", () => {
    it("should reject re-finalizing or re-executing already terminal executions", async () => {
      const terminalStatuses = [
        AutomationExecutionStatus.COMPLETED,
        AutomationExecutionStatus.FAILED,
        AutomationExecutionStatus.SKIPPED,
        AutomationExecutionStatus.TIMED_OUT,
      ];

      for (const status of terminalStatuses) {
        const execution = await prisma.automationExecution.create({
          data: {
            workspaceId: wsId,
            status,
            correlationId: `corr_term_${status}_${testRunId}`,
            executionDepth: 0,
            causalityChain: [],
            triggerPayloadJson: {},
            completedAt: new Date(),
            durationMs: 100,
          },
        });

        await expect(
          executeAutomationPipeline(wsId, execution.id, undefined, prisma),
        ).rejects.toThrow(AutomationExecutionAlreadyTerminalError);
      }
    });
  });

  // =========================================================================
  // 6. END-TO-END WORKFLOW ORCHESTRATOR
  // =========================================================================
  describe("6. Full Workflow Orchestrator (runAutomationWorkflow)", () => {
    it("should ingest event, evaluate conditions, execute actions, and return pipeline results end-to-end", async () => {
      vi.spyOn(workOrderService, "createWorkOrder").mockResolvedValue({
        id: "wo_e2e_1",
        workOrderNumber: "WO-2026-E2E",
      } as any);

      // Create full Rule with Trigger and Action
      const rule = await prisma.automationRule.create({
        data: {
          workspaceId: wsId,
          name: "E2E Ingestion and Execution Rule",
          isEnabled: true,
          trigger: {
            create: {
              workspaceId: wsId,
              triggerType: AutomationTriggerType.WORK_ORDER_CREATED,
              eventType: "work_order.created",
            },
          },
          actions: {
            create: [
              {
                workspaceId: wsId,
                stepOrder: 1,
                actionType: AutomationActionType.WORK_ORDER_CREATE,
                paramsJson: {
                  customerId: "cust_e2e",
                  locationId: "loc_e2e",
                  workTypeId: "wt_e2e",
                  title: "E2E Work Order",
                },
              },
            ],
          },
        },
      });

      const input = {
        workspaceId: wsId,
        eventType: "work_order.created",
        sourceEntity: "WorkOrder",
        sourceId: `wo_source_${testRunId}`,
        payload: { priority: "HIGH" },
      };

      const results = await runAutomationWorkflow(wsId, input, undefined, prisma);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(AutomationExecutionStatus.COMPLETED);
      expect(results[0].stepCount).toBe(1);
      expect(results[0].steps[0].status).toBe(AutomationExecutionStepStatus.COMPLETED);
    });
  });
});
