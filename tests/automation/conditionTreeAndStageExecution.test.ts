/**
 * Phase 1.16.4 — Condition Tree & Stage 3 Execution Engine Integration Tests
 */

import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  AutomationTriggerType,
  AutomationExecutionStatus,
  AutomationConditionLogicalOperator,
  ConditionOperator,
  AutomationErrorPolicy,
  AutomationActionType,
} from "@/generated/prisma/enums";
import {
  evaluateConditionGroup,
  evaluateExecutionConditionsStage,
} from "@/lib/services/automation/conditionEvaluatorService";
import type {
  ExecutionContext,
  AutomationConditionGroupData,
} from "@/lib/services/automation/automation.types";

describe("Phase 1.16.4 — Condition Tree & Stage 3 Execution Integration Tests", () => {
  let prisma: PrismaClient;
  const testRunId = `cond_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const ws1Id = `ws_cond_1_${testRunId}`;
  const ws2Id = `ws_cond_2_${testRunId}`;

  let ruleMatchingId: string;
  let ruleNonMatchingId: string;
  let ruleNoConditionId: string;

  let executionMatchingId: string;
  let executionNonMatchingId: string;
  let executionNoConditionId: string;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Create test workspaces
    await prisma.workspace.create({
      data: {
        id: ws1Id,
        name: `Condition Test Workspace 1 ${testRunId}`,
        slug: `cond-ws1-${testRunId}`,
      },
    });

    await prisma.workspace.create({
      data: {
        id: ws2Id,
        name: `Condition Test Workspace 2 ${testRunId}`,
        slug: `cond-ws2-${testRunId}`,
      },
    });

    // 2. Create Rule 1: High Priority + Amount > 1000 (Matching condition tree)
    const ruleMatching = await prisma.automationRule.create({
      data: {
        workspaceId: ws1Id,
        name: "Auto-Invoice for Urgent High-Value Work Orders",
        isEnabled: true,
        errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
        trigger: {
          create: {
            workspaceId: ws1Id,
            triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
            eventType: "WORK_ORDER_COMPLETED",
          },
        },
        conditionGroup: {
          create: {
            workspaceId: ws1Id,
            logicalOperator: AutomationConditionLogicalOperator.AND,
            conditions: {
              create: [
                {
                  workspaceId: ws1Id,
                  fieldPath: "trigger.payload.workOrder.priority",
                  operator: ConditionOperator.EQUALS,
                  targetValueJson: "URGENT",
                },
                {
                  workspaceId: ws1Id,
                  fieldPath: "trigger.payload.workOrder.totalAmount",
                  operator: ConditionOperator.GREATER_THAN,
                  targetValueJson: 1000,
                },
              ],
            },
          },
        },
        actions: {
          create: [
            {
              workspaceId: ws1Id,
              stepOrder: 1,
              actionType: AutomationActionType.INVOICE_CREATE_FROM_WORK_ORDER,
              paramsJson: {},
            },
          ],
        },
      },
    });
    ruleMatchingId = ruleMatching.id;

    // 3. Create Rule 2: Requires priority == "LOW" (Will fail condition evaluation)
    const ruleNonMatching = await prisma.automationRule.create({
      data: {
        workspaceId: ws1Id,
        name: "Low Priority Archive Rule",
        isEnabled: true,
        errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
        trigger: {
          create: {
            workspaceId: ws1Id,
            triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
            eventType: "WORK_ORDER_COMPLETED",
          },
        },
        conditionGroup: {
          create: {
            workspaceId: ws1Id,
            logicalOperator: AutomationConditionLogicalOperator.AND,
            conditions: {
              create: [
                {
                  workspaceId: ws1Id,
                  fieldPath: "trigger.payload.workOrder.priority",
                  operator: ConditionOperator.EQUALS,
                  targetValueJson: "LOW",
                },
              ],
            },
          },
        },
      },
    });
    ruleNonMatchingId = ruleNonMatching.id;

    // 4. Create Rule 3: Rule with NO condition group (Vacuously true)
    const ruleNoCondition = await prisma.automationRule.create({
      data: {
        workspaceId: ws1Id,
        name: "Unconditional Work Order Rule",
        isEnabled: true,
        errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
        trigger: {
          create: {
            workspaceId: ws1Id,
            triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
            eventType: "WORK_ORDER_COMPLETED",
          },
        },
      },
    });
    ruleNoConditionId = ruleNoCondition.id;

    // 5. Create PENDING Execution records
    const exec1 = await prisma.automationExecution.create({
      data: {
        workspaceId: ws1Id,
        ruleId: ruleMatchingId,
        status: AutomationExecutionStatus.PENDING,
        correlationId: `corr-matching-${testRunId}`,
        causalityChain: [],
        executionDepth: 0,
        triggerPayloadJson: {
          workOrder: {
            id: "wo_test_match",
            priority: "URGENT",
            totalAmount: 2500,
          },
        },
        dedupeKey: `dedupe_match_${testRunId}`,
      },
    });
    executionMatchingId = exec1.id;

    const exec2 = await prisma.automationExecution.create({
      data: {
        workspaceId: ws1Id,
        ruleId: ruleNonMatchingId,
        status: AutomationExecutionStatus.PENDING,
        correlationId: `corr-nonmatching-${testRunId}`,
        causalityChain: [],
        executionDepth: 0,
        triggerPayloadJson: {
          workOrder: {
            id: "wo_test_nonmatch",
            priority: "URGENT", // Does NOT match "LOW"
            totalAmount: 2500,
          },
        },
        dedupeKey: `dedupe_nonmatch_${testRunId}`,
      },
    });
    executionNonMatchingId = exec2.id;

    const exec3 = await prisma.automationExecution.create({
      data: {
        workspaceId: ws1Id,
        ruleId: ruleNoConditionId,
        status: AutomationExecutionStatus.PENDING,
        correlationId: `corr-nocond-${testRunId}`,
        causalityChain: [],
        executionDepth: 0,
        triggerPayloadJson: {
          workOrder: {
            id: "wo_test_nocond",
            priority: "MEDIUM",
          },
        },
        dedupeKey: `dedupe_nocond_${testRunId}`,
      },
    });
    executionNoConditionId = exec3.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (ws1Id) {
        await prisma.workspace.delete({ where: { id: ws1Id } }).catch(() => {});
      }
      if (ws2Id) {
        await prisma.workspace.delete({ where: { id: ws2Id } }).catch(() => {});
      }
      await prisma.$disconnect().catch(() => {});
    }
  });

  describe("1. Recursive Condition Tree Evaluation Unit Logic", () => {
    const mockContext: ExecutionContext = {
      workspaceId: "ws_unit",
      trigger: {
        payload: {
          workOrder: {
            priority: "URGENT",
            totalAmount: 4500,
            status: "COMPLETED",
            department: "HVAC",
          },
        },
      },
    };

    it("should evaluate a root AND group with nested OR child group (passes)", () => {
      const tree: AutomationConditionGroupData = {
        logicalOperator: AutomationConditionLogicalOperator.AND,
        conditions: [
          {
            fieldPath: "trigger.payload.workOrder.priority",
            operator: ConditionOperator.EQUALS,
            targetValueJson: "URGENT",
          },
        ],
        childGroups: [
          {
            logicalOperator: AutomationConditionLogicalOperator.OR,
            conditions: [
              {
                fieldPath: "trigger.payload.workOrder.totalAmount",
                operator: ConditionOperator.GREATER_THAN,
                targetValueJson: 10000, // false (4500 is not > 10000)
              },
              {
                fieldPath: "trigger.payload.workOrder.department",
                operator: ConditionOperator.EQUALS,
                targetValueJson: "HVAC", // true
              },
            ],
          },
        ],
      };

      expect(evaluateConditionGroup(tree, mockContext)).toBe(true);
    });

    it("should evaluate a root AND group with nested OR child group (fails on leaf condition)", () => {
      const tree: AutomationConditionGroupData = {
        logicalOperator: AutomationConditionLogicalOperator.AND,
        conditions: [
          {
            fieldPath: "trigger.payload.workOrder.priority",
            operator: ConditionOperator.EQUALS,
            targetValueJson: "LOW", // false!
          },
        ],
        childGroups: [
          {
            logicalOperator: AutomationConditionLogicalOperator.OR,
            conditions: [
              {
                fieldPath: "trigger.payload.workOrder.department",
                operator: ConditionOperator.EQUALS,
                targetValueJson: "HVAC",
              },
            ],
          },
        ],
      };

      expect(evaluateConditionGroup(tree, mockContext)).toBe(false);
    });

    it("should evaluate null or empty condition group as vacuously true", () => {
      expect(evaluateConditionGroup(null, mockContext)).toBe(true);
      expect(evaluateConditionGroup(undefined, mockContext)).toBe(true);
      expect(
        evaluateConditionGroup(
          {
            logicalOperator: AutomationConditionLogicalOperator.AND,
            conditions: [],
            childGroups: [],
          },
          mockContext
        )
      ).toBe(true);
    });
  });

  describe("2. Stage 3 Execution Engine Wiring (Real DB Integration)", () => {
    it("should pass conditions and keep execution in PENDING state when conditions are met", async () => {
      const result = await evaluateExecutionConditionsStage(prisma, ws1Id, executionMatchingId);

      expect(result.passed).toBe(true);
      expect(result.status).toBe(AutomationExecutionStatus.PENDING);
      expect(result.reasonCode).toBeNull();

      // Verify DB record remained PENDING
      const exec = await prisma.automationExecution.findUnique({
        where: { id: executionMatchingId },
      });
      expect(exec?.status).toBe(AutomationExecutionStatus.PENDING);
      expect(exec?.reasonCode).toBeNull();
      expect(exec?.completedAt).toBeNull();
    });

    it("should fail conditions and update execution to SKIPPED (CONDITIONS_NOT_MET) when not met", async () => {
      const result = await evaluateExecutionConditionsStage(prisma, ws1Id, executionNonMatchingId);

      expect(result.passed).toBe(false);
      expect(result.status).toBe(AutomationExecutionStatus.SKIPPED);
      expect(result.reasonCode).toBe("CONDITIONS_NOT_MET");

      // Verify DB record was transitioned to SKIPPED with CONDITIONS_NOT_MET
      const exec = await prisma.automationExecution.findUnique({
        where: { id: executionNonMatchingId },
      });
      expect(exec?.status).toBe(AutomationExecutionStatus.SKIPPED);
      expect(exec?.reasonCode).toBe("CONDITIONS_NOT_MET");
      expect(exec?.completedAt).not.toBeNull();
      expect(exec?.durationMs).toBe(0);
    });

    it("should evaluate rule with no condition group as vacuously true and keep PENDING", async () => {
      const result = await evaluateExecutionConditionsStage(prisma, ws1Id, executionNoConditionId);

      expect(result.passed).toBe(true);
      expect(result.status).toBe(AutomationExecutionStatus.PENDING);
      expect(result.reasonCode).toBeNull();

      const exec = await prisma.automationExecution.findUnique({
        where: { id: executionNoConditionId },
      });
      expect(exec?.status).toBe(AutomationExecutionStatus.PENDING);
    });

    it("should evaluate a 5-level deeply nested condition group tree with 100% accuracy without truncation", async () => {
      // 1. Create Rule with 5-level deep hierarchy
      const deepRule = await prisma.automationRule.create({
        data: {
          workspaceId: ws1Id,
          name: "Deep Nested Condition Rule (5 levels)",
          isEnabled: true,
          errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
          trigger: {
            create: {
              workspaceId: ws1Id,
              triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
              eventType: "WORK_ORDER_COMPLETED",
            },
          },
        },
      });

      // Level 1: Root AND
      const groupL1 = await prisma.automationConditionGroup.create({
        data: {
          workspaceId: ws1Id,
          ruleId: deepRule.id,
          logicalOperator: AutomationConditionLogicalOperator.AND,
          conditions: {
            create: [
              {
                workspaceId: ws1Id,
                fieldPath: "trigger.payload.workOrder.status",
                operator: ConditionOperator.EQUALS,
                targetValueJson: "COMPLETED",
              },
            ],
          },
        },
      });

      // Level 2: Child OR
      const groupL2 = await prisma.automationConditionGroup.create({
        data: {
          workspaceId: ws1Id,
          parentGroupId: groupL1.id,
          logicalOperator: AutomationConditionLogicalOperator.OR,
        },
      });

      // Level 3: Child AND
      const groupL3 = await prisma.automationConditionGroup.create({
        data: {
          workspaceId: ws1Id,
          parentGroupId: groupL2.id,
          logicalOperator: AutomationConditionLogicalOperator.AND,
        },
      });

      // Level 4: Child OR
      const groupL4 = await prisma.automationConditionGroup.create({
        data: {
          workspaceId: ws1Id,
          parentGroupId: groupL3.id,
          logicalOperator: AutomationConditionLogicalOperator.OR,
        },
      });

      // Level 5: Child AND with leaf condition at depth 5
      await prisma.automationConditionGroup.create({
        data: {
          workspaceId: ws1Id,
          parentGroupId: groupL4.id,
          logicalOperator: AutomationConditionLogicalOperator.AND,
          conditions: {
            create: [
              {
                workspaceId: ws1Id,
                fieldPath: "trigger.payload.workOrder.items[0].sku",
                operator: ConditionOperator.EQUALS,
                targetValueJson: "SPECIAL-VALVE",
              },
            ],
          },
        },
      });

      // Case A: Matching payload (Level 5 condition is met -> passes)
      const execDeepMatching = await prisma.automationExecution.create({
        data: {
          workspaceId: ws1Id,
          ruleId: deepRule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr-deep-match-${testRunId}`,
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: {
            workOrder: {
              status: "COMPLETED",
              items: [{ sku: "SPECIAL-VALVE" }],
            },
          },
          dedupeKey: `dedupe_deep_match_${testRunId}`,
        },
      });

      const resultPass = await evaluateExecutionConditionsStage(prisma, ws1Id, execDeepMatching.id);
      expect(resultPass.passed).toBe(true);
      expect(resultPass.status).toBe(AutomationExecutionStatus.PENDING);

      // Case B: Non-matching payload (Level 5 condition fails -> transitions to SKIPPED)
      const execDeepNonMatching = await prisma.automationExecution.create({
        data: {
          workspaceId: ws1Id,
          ruleId: deepRule.id,
          status: AutomationExecutionStatus.PENDING,
          correlationId: `corr-deep-nonmatch-${testRunId}`,
          causalityChain: [],
          executionDepth: 0,
          triggerPayloadJson: {
            workOrder: {
              status: "COMPLETED",
              items: [{ sku: "STANDARD-VALVE" }], // Does NOT match "SPECIAL-VALVE"
            },
          },
          dedupeKey: `dedupe_deep_nonmatch_${testRunId}`,
        },
      });

      const resultFail = await evaluateExecutionConditionsStage(prisma, ws1Id, execDeepNonMatching.id);
      expect(resultFail.passed).toBe(false);
      expect(resultFail.status).toBe(AutomationExecutionStatus.SKIPPED);
      expect(resultFail.reasonCode).toBe("CONDITIONS_NOT_MET");
    }, 20000);

    it("should enforce tenant isolation (Invariant 1) and reject execution query for another workspace", async () => {
      // WS2 attempts to evaluate WS1's execution
      await expect(
        evaluateExecutionConditionsStage(prisma, ws2Id, executionMatchingId)
      ).rejects.toThrow();
    });
  });
});
