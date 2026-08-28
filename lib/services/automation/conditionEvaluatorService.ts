/**
 * Phase 1.16.4 — Condition Evaluator Service (Stage 3 Execution Engine)
 *
 * Recursively evaluates nested AutomationConditionGroup trees against ExecutionContext,
 * and wires Stage 3 outcomes: transitions PENDING executions to SKIPPED (CONDITIONS_NOT_MET)
 * when condition trees evaluate to false, or preserves PENDING state when conditions pass.
 */

import { prisma as defaultPrisma } from "@/lib/prisma";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
  AutomationConditionLogicalOperator,
  AutomationExecutionStatus,
} from "@/generated/prisma/enums";
import type {
  ExecutionContext,
  AutomationConditionData,
  AutomationConditionGroupData,
  ConditionStageResult,
} from "./automation.types";
import { resolveFieldPath } from "./fieldPathResolver";
import { evaluateOperator } from "./operatorEvaluator";
import {
  AutomationValidationError,
  AutomationRuleNotFoundError,
} from "./automationErrors";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Evaluates a single leaf AutomationCondition against an ExecutionContext.
 */
export function evaluateCondition(
  condition: AutomationConditionData,
  context: ExecutionContext,
  now: Date = new Date()
): boolean {
  if (!condition || !condition.operator || !condition.fieldPath) {
    return false;
  }

  const resolvedValue = resolveFieldPath(context, condition.fieldPath);
  return evaluateOperator(condition.operator, resolvedValue, condition.targetValueJson, now);
}

/**
 * Recursively evaluates an AutomationConditionGroup tree with AND / OR logical operators.
 *
 * Rules:
 * - If group is null/undefined (rule has no condition group configured), evaluates to true (vacuously true).
 * - If group has zero conditions and zero child groups, evaluates to true.
 * - Logical AND: short-circuits on first false.
 * - Logical OR: short-circuits on first true.
 */
export function evaluateConditionGroup(
  group: AutomationConditionGroupData | null | undefined,
  context: ExecutionContext,
  now: Date = new Date()
): boolean {
  if (!group) {
    // Vacuous truth: A rule with no condition group runs unconditionally
    return true;
  }

  const conditions = group.conditions ?? [];
  const childGroups = group.childGroups ?? [];

  if (conditions.length === 0 && childGroups.length === 0) {
    return true;
  }

  if (group.logicalOperator === AutomationConditionLogicalOperator.AND) {
    // All conditions and all child groups must evaluate to true
    for (const condition of conditions) {
      const passed = evaluateCondition(condition, context, now);
      if (!passed) {
        return false;
      }
    }

    for (const childGroup of childGroups) {
      const passed = evaluateConditionGroup(childGroup, context, now);
      if (!passed) {
        return false;
      }
    }

    return true;
  }

  if (group.logicalOperator === AutomationConditionLogicalOperator.OR) {
    // At least one condition or child group must evaluate to true
    for (const condition of conditions) {
      const passed = evaluateCondition(condition, context, now);
      if (passed) {
        return true;
      }
    }

    for (const childGroup of childGroups) {
      const passed = evaluateConditionGroup(childGroup, context, now);
      if (passed) {
        return true;
      }
    }

    return false;
  }

  return false;
}

/**
 * Genuinely unbounded recursive loader for an AutomationConditionGroup tree.
 * Iteratively fetches all levels of childGroups and leaf conditions using BFS
 * scoped strictly by workspaceId (Invariant 1) and reconstructs the full hierarchical
 * in-memory tree with zero depth truncation.
 */
export async function loadConditionGroupTree(
  prisma: DbClient,
  workspaceId: string,
  rootGroupId: string
): Promise<AutomationConditionGroupData | null> {
  const db = prisma as PrismaClient;

  // 1. Fetch Root Condition Group
  const rootGroup = await db.automationConditionGroup.findFirst({
    where: {
      id: rootGroupId,
      workspaceId, // INVARIANT 1: Strict Workspace Tenant Isolation
    },
    include: {
      conditions: true,
    },
  });

  if (!rootGroup) {
    return null;
  }

  const allGroupsMap = new Map<string, AutomationConditionGroupData>();

  const rootData: AutomationConditionGroupData = {
    id: rootGroup.id,
    logicalOperator: rootGroup.logicalOperator,
    conditions: rootGroup.conditions.map((c) => ({
      id: c.id,
      fieldPath: c.fieldPath,
      operator: c.operator,
      targetValueJson: c.targetValueJson,
      valueType: c.valueType,
    })),
    childGroups: [],
  };

  allGroupsMap.set(rootGroup.id, rootData);

  // 2. Iteratively fetch deeper levels (BFS frontier)
  let frontierIds = [rootGroup.id];

  while (frontierIds.length > 0) {
    const nextLevelGroups = await db.automationConditionGroup.findMany({
      where: {
        workspaceId, // INVARIANT 1
        parentGroupId: { in: frontierIds },
      },
      include: {
        conditions: true,
      },
    });

    if (nextLevelGroups.length === 0) {
      break;
    }

    const nextFrontierIds: string[] = [];

    for (const group of nextLevelGroups) {
      const groupData: AutomationConditionGroupData = {
        id: group.id,
        logicalOperator: group.logicalOperator,
        conditions: group.conditions.map((c) => ({
          id: c.id,
          fieldPath: c.fieldPath,
          operator: c.operator,
          targetValueJson: c.targetValueJson,
          valueType: c.valueType,
        })),
        childGroups: [],
      };

      allGroupsMap.set(group.id, groupData);
      nextFrontierIds.push(group.id);

      // Attach group to its parent
      if (group.parentGroupId && allGroupsMap.has(group.parentGroupId)) {
        const parent = allGroupsMap.get(group.parentGroupId)!;
        parent.childGroups = parent.childGroups ?? [];
        parent.childGroups.push(groupData);
      }
    }

    frontierIds = nextFrontierIds;
  }

  return rootData;
}

/**
 * Stage 3 Execution Engine entry point:
 * Evaluates conditions for an active PENDING execution.
 *
 * Lifecycle Behavior (Section 2.2 Stage 3 & Short-Circuit Matrix):
 * - If conditions evaluate TRUE: Hands off toward execution initialization (Stage 4 / 1.16.6).
 * - If conditions evaluate FALSE: Updates execution to status SKIPPED with reasonCode "CONDITIONS_NOT_MET".
 *
 * @param prisma - PrismaClient or TransactionClient
 * @param workspaceId - Tenant workspace identifier (Invariant 1)
 * @param executionId - AutomationExecution primary key
 * @param now - Optional reference date for testing temporal operators
 */
export async function evaluateExecutionConditionsStage(
  prisma: DbClient,
  workspaceId: string,
  executionId: string,
  now: Date = new Date()
): Promise<ConditionStageResult> {
  const db = prisma ?? defaultPrisma;

  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }

  if (!executionId || typeof executionId !== "string") {
    throw new AutomationValidationError("Valid executionId is required");
  }

  // 1. Fetch Execution and Rule metadata (Strictly tenant scoped per Invariant 1)
  const execution = await (db as PrismaClient).automationExecution.findFirst({
    where: {
      id: executionId,
      workspaceId, // INVARIANT 1: Strict Workspace Tenant Isolation
    },
    include: {
      rule: {
        include: {
          trigger: true,
          conditionGroup: {
            select: { id: true },
          },
        },
      },
    },
  });

  if (!execution) {
    throw new AutomationRuleNotFoundError(`Execution '${executionId}' not found in workspace '${workspaceId}'`);
  }

  // 2. Build ExecutionContext from execution record
  const context: ExecutionContext = {
    workspaceId,
    ruleId: execution.ruleId,
    executionId: execution.id,
    trigger: {
      type: execution.rule?.trigger?.triggerType,
      eventType: execution.rule?.trigger?.eventType,
      payload: (execution.triggerPayloadJson as Record<string, unknown>) || {},
    },
    steps: {},
    metadata: {},
    correlationId: execution.correlationId,
    executionDepth: execution.executionDepth,
  };

  // 3. Genuinely unbounded recursive tree load & evaluation
  let conditionGroupTree: AutomationConditionGroupData | null = null;
  if (execution.rule?.conditionGroup?.id) {
    conditionGroupTree = await loadConditionGroupTree(
      db,
      workspaceId,
      execution.rule.conditionGroup.id
    );
  }

  const passed = evaluateConditionGroup(conditionGroupTree, context, now);

  if (passed) {
    return {
      executionId: execution.id,
      workspaceId,
      passed: true,
      status: execution.status,
      reasonCode: null,
    };
  }

  // 4. Short-circuit: Transition execution to SKIPPED with CONDITIONS_NOT_MET
  const updatedExecution = await (db as PrismaClient).automationExecution.update({
    where: { id: execution.id },
    data: {
      status: AutomationExecutionStatus.SKIPPED,
      reasonCode: "CONDITIONS_NOT_MET",
      completedAt: new Date(),
      durationMs: 0,
    },
    select: {
      id: true,
      status: true,
      reasonCode: true,
    },
  });

  return {
    executionId: updatedExecution.id,
    workspaceId,
    passed: false,
    status: updatedExecution.status,
    reasonCode: updatedExecution.reasonCode,
  };
}
