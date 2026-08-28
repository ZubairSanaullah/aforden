/**
 * Phase 1.16.8 — Automation Management Services
 *
 * Enterprise CRUD and administrative management service layer for Automation Rules,
 * Triggers, Conditions, Actions, Execution Traces, and Schedule Jobs.
 *
 * Enforces:
 * - Invariant 1: Multi-tenant workspace isolation.
 * - Invariant 2: RBAC permissions (AUTOMATIONS_MANAGE for OWNER/ADMIN; AUTOMATIONS_VIEW/RUN for MANAGER).
 * - Invariant 4: Append-only immutable execution history.
 * - Phase 1.15: Strict entitlement delegation via assertEntitlement/resolveEntitlement (FEATURE_AUTOMATIONS).
 */

import { z } from "zod";
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
  AutomationTriggerType,
  AutomationActionType,
  AutomationErrorPolicy,
  AutomationExecutionStatus,
  ConditionOperator,
} from "@/generated/prisma/enums";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";
import {
  AutomationValidationError,
  AutomationRuleNotFoundError,
  AutomationExecutionNotFoundError,
  AutomationScheduleJobNotFoundError,
} from "./automationErrors";
import type {
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
  ListAutomationRulesQuery,
  ListAutomationExecutionsQuery,
  ListScheduleJobsQuery,
  TestRunAutomationRuleInput,
} from "./automation.types";
import {
  runAutomationWorkflow,
  executeAutomationPipeline,
} from "./executionEngineService";
import { evaluateExecutionConditionsStage } from "./conditionEvaluatorService";


type DbClient = PrismaClient | Prisma.TransactionClient;

// ============================================================================
// ZOD VALIDATION SCHEMAS
// ============================================================================

export const createConditionSchema = z.object({
  fieldPath: z.string().min(1, "fieldPath is required"),
  operator: z.nativeEnum(ConditionOperator),
  targetValueJson: z.unknown(),
  valueType: z.string().optional().nullable(),
});

export const createConditionGroupSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    logicalOperator: z.enum(["AND", "OR"]),
    conditions: z.array(createConditionSchema).optional().default([]),
    childGroups: z.array(createConditionGroupSchema).optional().default([]),
  }),
);

export const createActionSchema = z.object({
  stepOrder: z.number().int().positive("stepOrder must be a positive integer"),
  actionType: z.nativeEnum(AutomationActionType),
  paramsJson: z.record(z.string(), z.unknown()).default({}),
});

export const createTriggerSchema = z.object({
  triggerType: z.nativeEnum(AutomationTriggerType),
  eventType: z.string().min(1, "eventType is required"),
  configJson: z.record(z.string(), z.unknown()).optional().nullable(),
  filterJson: z.record(z.string(), z.unknown()).optional().nullable(),
});


export const createAutomationRuleSchema = z.object({
  name: z.string().min(1, "name is required").max(128, "name must be <= 128 chars"),
  description: z.string().max(512).optional().nullable(),
  isEnabled: z.boolean().optional().default(true),
  errorPolicy: z.nativeEnum(AutomationErrorPolicy).optional().default(AutomationErrorPolicy.HALT_ON_ERROR),
  trigger: createTriggerSchema.optional().nullable(),
  conditionGroup: createConditionGroupSchema.optional().nullable(),
  actions: z.array(createActionSchema).optional().default([]),
});

export const updateAutomationRuleSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional().nullable(),
  isEnabled: z.boolean().optional(),
  errorPolicy: z.nativeEnum(AutomationErrorPolicy).optional(),
  trigger: createTriggerSchema.optional().nullable(),
  conditionGroup: createConditionGroupSchema.optional().nullable(),
  actions: z.array(createActionSchema).optional(),
});

// ============================================================================
// HELPER: RECURSIVE CONDITION GROUP CREATION
// ============================================================================

async function createNestedConditionGroup(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  ruleId: string,
  groupInput: any,
  parentGroupId: string | null = null,
): Promise<string> {
  const createdGroup = await tx.automationConditionGroup.create({
    data: {
      workspaceId, // INVARIANT 1
      ruleId: parentGroupId ? null : ruleId,
      parentGroupId,
      logicalOperator: groupInput.logicalOperator || "AND",
    },
  });


  // Create Conditions
  if (Array.isArray(groupInput.conditions) && groupInput.conditions.length > 0) {
    await tx.automationCondition.createMany({
      data: groupInput.conditions.map((c: any) => ({
        workspaceId, // INVARIANT 1
        conditionGroupId: createdGroup.id,
        fieldPath: c.fieldPath,
        operator: c.operator,
        targetValueJson: (c.targetValueJson as Prisma.InputJsonValue) ?? null,
        valueType: c.valueType ?? null,
      })),
    });
  }

  // Recursively create Child Groups
  if (Array.isArray(groupInput.childGroups) && groupInput.childGroups.length > 0) {
    for (const child of groupInput.childGroups) {
      await createNestedConditionGroup(tx, workspaceId, ruleId, child, createdGroup.id);
    }
  }

  return createdGroup.id;
}

// ============================================================================
// RULE MANAGEMENT SERVICES
// ============================================================================

/**
 * Creates a new AutomationRule with its trigger, nested conditions, and actions atomically.
 */
export async function createAutomationRule(
  workspaceId: string,
  input: CreateAutomationRuleInput,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }

  // 1. RBAC Check: AUTOMATIONS_MANAGE (OWNER, ADMIN)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_MANAGE);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  // 2. Entitlement Gate: FEATURE_AUTOMATIONS (Phase 1.15)
  await assertEntitlement(db, workspaceId, "FEATURE_AUTOMATIONS");

  // 3. Schema Validation
  const validated = createAutomationRuleSchema.parse(input);


  // Validate contiguous step order for actions
  if (validated.actions && validated.actions.length > 0) {
    const sorted = [...validated.actions].sort((a, b) => a.stepOrder - b.stepOrder);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].stepOrder !== i + 1) {
        throw new AutomationValidationError(
          `Action step orders must be contiguous starting from 1 (expected ${i + 1}, got ${sorted[i].stepOrder})`,
        );
      }
    }
  }

  return db.$transaction(async (tx) => {

    // 4. Create Rule
    const rule = await tx.automationRule.create({
      data: {
        workspaceId, // INVARIANT 1
        name: validated.name,
        description: validated.description ?? null,
        isEnabled: validated.isEnabled ?? true,
        errorPolicy: validated.errorPolicy ?? AutomationErrorPolicy.HALT_ON_ERROR,
      },
    });

    // 5. Create Trigger (if provided)
    if (validated.trigger) {
      await tx.automationTrigger.create({
        data: {
          workspaceId, // INVARIANT 1
          ruleId: rule.id,
          triggerType: validated.trigger.triggerType,
          eventType: validated.trigger.eventType,
          configJson:
            (validated.trigger.configJson as Prisma.InputJsonValue) ??
            (validated.trigger.filterJson as Prisma.InputJsonValue) ??
            null,
        },
      });
    }


    // 6. Create Condition Tree (if provided)
    if (validated.conditionGroup) {
      await createNestedConditionGroup(tx, workspaceId, rule.id, validated.conditionGroup, null);
    }

    // 7. Create Actions (if provided)
    if (validated.actions && validated.actions.length > 0) {
      await tx.automationAction.createMany({
        data: validated.actions.map((act) => ({
          workspaceId, // INVARIANT 1
          ruleId: rule.id,
          stepOrder: act.stepOrder,
          actionType: act.actionType,
          paramsJson: (act.paramsJson as Prisma.InputJsonValue) ?? {},
        })),
      });
    }

    // Return complete rule graph
    return tx.automationRule.findUniqueOrThrow({
      where: { id: rule.id },
      include: {
        trigger: true,
        conditionGroup: {
          include: {
            conditions: true,
            childGroups: {
              include: {
                conditions: true,
                childGroups: {
                  include: {
                    conditions: true,
                  },
                },
              },
            },
          },
        },
        actions: {
          orderBy: { stepOrder: "asc" },
        },
        scheduleJobs: true,
      },
    });
  });
}

/**
 * Retrieves a single AutomationRule by ID with its complete graph.
 */
export async function getAutomationRule(
  workspaceId: string,
  ruleId: string,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }
  if (!ruleId || typeof ruleId !== "string") {
    throw new AutomationValidationError("Valid ruleId is required");
  }

  // RBAC Check: AUTOMATIONS_VIEW (OWNER, ADMIN, MANAGER)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_VIEW);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  const rule = await db.automationRule.findFirst({
    where: {
      id: ruleId,
      workspaceId, // INVARIANT 1
    },
    include: {
      trigger: true,
      conditionGroup: {
        include: {
          conditions: true,
          childGroups: {
            include: {
              conditions: true,
              childGroups: {
                include: {
                  conditions: true,
                },
              },
            },
          },
        },
      },
      actions: {
        orderBy: { stepOrder: "asc" },
      },
      scheduleJobs: true,
    },
  });

  if (!rule) {
    throw new AutomationRuleNotFoundError(
      `AutomationRule '${ruleId}' not found in workspace '${workspaceId}'`,
    );
  }

  return rule;
}

/**
 * Lists AutomationRules with pagination, filtering, and sorting.
 */
export async function listAutomationRules(
  workspaceId: string,
  query?: ListAutomationRulesQuery,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }

  // RBAC Check: AUTOMATIONS_VIEW (OWNER, ADMIN, MANAGER)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_VIEW);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  const page = Math.max(1, query?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query?.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const whereClause: Prisma.AutomationRuleWhereInput = {
    workspaceId, // INVARIANT 1
    ...(query?.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {}),
    ...(query?.triggerType
      ? {
          trigger: {
            triggerType: query.triggerType as AutomationTriggerType,
          },
        }
      : {}),
    ...(query?.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const sortBy = query?.sortBy ?? "createdAt";
  const sortOrder = query?.sortOrder ?? "desc";

  const [rules, total] = await Promise.all([
    db.automationRule.findMany({
      where: whereClause,
      include: {
        trigger: true,
        actions: {
          orderBy: { stepOrder: "asc" },
        },
        _count: {
          select: {
            executions: true,
            scheduleJobs: true,
          },
        },
      },
      skip,
      take: pageSize,
      orderBy: { [sortBy]: sortOrder },
    }),
    db.automationRule.count({ where: whereClause }),
  ]);

  return {
    rules,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Updates an existing AutomationRule and optionally replaces triggers, conditions, or actions.
 */
export async function updateAutomationRule(
  workspaceId: string,
  ruleId: string,
  input: UpdateAutomationRuleInput,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }
  if (!ruleId || typeof ruleId !== "string") {
    throw new AutomationValidationError("Valid ruleId is required");
  }

  // 1. RBAC Check: AUTOMATIONS_MANAGE (OWNER, ADMIN)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_MANAGE);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  // 2. Entitlement Gate: FEATURE_AUTOMATIONS (Phase 1.15)
  await assertEntitlement(db, workspaceId, "FEATURE_AUTOMATIONS");

  const validated = updateAutomationRuleSchema.parse(input);

  // Verify existence & tenant ownership
  const existing = await db.automationRule.findFirst({
    where: { id: ruleId, workspaceId },
  });

  if (!existing) {
    throw new AutomationRuleNotFoundError(
      `AutomationRule '${ruleId}' not found in workspace '${workspaceId}'`,
    );
  }

  return db.$transaction(async (tx) => {
    // 3. Update Rule Core Fields
    await tx.automationRule.update({
      where: { id: ruleId },
      data: {
        ...(validated.name ? { name: validated.name } : {}),
        ...(validated.description !== undefined ? { description: validated.description } : {}),
        ...(validated.isEnabled !== undefined ? { isEnabled: validated.isEnabled } : {}),
        ...(validated.errorPolicy ? { errorPolicy: validated.errorPolicy } : {}),
      },
    });

    // 4. Update Trigger (if explicitly provided)
    if (validated.trigger !== undefined) {
      await tx.automationTrigger.deleteMany({
        where: { ruleId, workspaceId },
      });

      if (validated.trigger) {
        await tx.automationTrigger.create({
          data: {
            workspaceId,
            ruleId,
            triggerType: validated.trigger.triggerType,
            eventType: validated.trigger.eventType,
            configJson:
              (validated.trigger.configJson as Prisma.InputJsonValue) ??
              (validated.trigger.filterJson as Prisma.InputJsonValue) ??
              null,
          },
        });
      }

    }

    // 5. Update Condition Group (if explicitly provided)
    if (validated.conditionGroup !== undefined) {
      await tx.automationConditionGroup.deleteMany({
        where: { ruleId, workspaceId },
      });

      if (validated.conditionGroup) {
        await createNestedConditionGroup(tx, workspaceId, ruleId, validated.conditionGroup, null);
      }
    }

    // 6. Update Actions (if explicitly provided)
    if (validated.actions !== undefined) {
      if (validated.actions.length > 0) {
        const sorted = [...validated.actions].sort((a, b) => a.stepOrder - b.stepOrder);
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].stepOrder !== i + 1) {
            throw new AutomationValidationError(
              `Action step orders must be contiguous starting from 1 (expected ${i + 1}, got ${sorted[i].stepOrder})`,
            );
          }
        }
      }

      await tx.automationAction.deleteMany({
        where: { ruleId, workspaceId },
      });

      if (validated.actions.length > 0) {
        await tx.automationAction.createMany({
          data: validated.actions.map((act) => ({
            workspaceId,
            ruleId,
            stepOrder: act.stepOrder,
            actionType: act.actionType,
            paramsJson: (act.paramsJson as Prisma.InputJsonValue) ?? {},
          })),
        });
      }
    }

    return tx.automationRule.findUniqueOrThrow({
      where: { id: ruleId },
      include: {
        trigger: true,
        conditionGroup: {
          include: {
            conditions: true,
            childGroups: {
              include: {
                conditions: true,
              },
            },
          },
        },
        actions: {
          orderBy: { stepOrder: "asc" },
        },
        scheduleJobs: true,
      },
    });
  });
}

/**
 * Toggles the enabled/disabled state of an AutomationRule.
 */
export async function toggleAutomationRule(
  workspaceId: string,
  ruleId: string,
  isEnabled: boolean,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }
  if (!ruleId || typeof ruleId !== "string") {
    throw new AutomationValidationError("Valid ruleId is required");
  }

  // 1. RBAC Check: AUTOMATIONS_MANAGE (OWNER, ADMIN)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_MANAGE);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  // 2. Entitlement Gate: FEATURE_AUTOMATIONS (Phase 1.15)
  await assertEntitlement(db, workspaceId, "FEATURE_AUTOMATIONS");

  const existing = await db.automationRule.findFirst({
    where: { id: ruleId, workspaceId },
  });

  if (!existing) {
    throw new AutomationRuleNotFoundError(
      `AutomationRule '${ruleId}' not found in workspace '${workspaceId}'`,
    );
  }

  return db.automationRule.update({
    where: { id: ruleId },
    data: { isEnabled },
    include: {
      trigger: true,
      actions: { orderBy: { stepOrder: "asc" } },
    },
  });
}

/**
 * Deletes an AutomationRule.
 * Invariant 4: Execution history is append-only; rule deletion sets ruleId: null on executions.
 */
export async function deleteAutomationRule(
  workspaceId: string,
  ruleId: string,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }
  if (!ruleId || typeof ruleId !== "string") {
    throw new AutomationValidationError("Valid ruleId is required");
  }

  // 1. RBAC Check: AUTOMATIONS_MANAGE (OWNER, ADMIN)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_MANAGE);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  // 2. Entitlement Gate: FEATURE_AUTOMATIONS (Phase 1.15)
  await assertEntitlement(db, workspaceId, "FEATURE_AUTOMATIONS");

  const existing = await db.automationRule.findFirst({
    where: { id: ruleId, workspaceId },
  });

  if (!existing) {
    throw new AutomationRuleNotFoundError(
      `AutomationRule '${ruleId}' not found in workspace '${workspaceId}'`,
    );
  }

  await db.automationRule.delete({
    where: { id: ruleId },
  });

  return { success: true, deletedRuleId: ruleId };
}

/**
 * Manually executes an AutomationRule in test mode with a synthetic payload.
 */
export async function testRunAutomationRule(
  workspaceId: string,
  ruleId: string,
  testInput: TestRunAutomationRuleInput,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }
  if (!ruleId || typeof ruleId !== "string") {
    throw new AutomationValidationError("Valid ruleId is required");
  }

  // 1. RBAC Check: AUTOMATIONS_RUN (OWNER, ADMIN, MANAGER)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_RUN);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  // 2. Entitlement Gate: FEATURE_AUTOMATIONS (Phase 1.15)
  await assertEntitlement(db, workspaceId, "FEATURE_AUTOMATIONS");

  const rule = await db.automationRule.findFirst({
    where: { id: ruleId, workspaceId },
    include: { trigger: true },
  });

  if (!rule) {
    throw new AutomationRuleNotFoundError(
      `AutomationRule '${ruleId}' not found in workspace '${workspaceId}'`,
    );
  }

  const eventType = testInput.eventType || rule.trigger?.eventType || "test.manual_run";

  const dedupeKey = `test_run_${ruleId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const correlationId = `corr_test_${Date.now()}`;

  // 3. Create single test execution record (Invariant 1)
  const execution = await db.automationExecution.create({
    data: {
      workspaceId, // INVARIANT 1
      ruleId,
      status: AutomationExecutionStatus.PENDING,
      correlationId,
      causalityChain: [],
      executionDepth: 0,
      triggerPayloadJson: (testInput.payload as Prisma.InputJsonValue) ?? {},
      dedupeKey,
    },
  });

  // 4. Stage 3: Evaluate Conditions
  const conditionResult = await evaluateExecutionConditionsStage(
    db,
    workspaceId,
    execution.id,
  );

  let pipelineResult;
  if (conditionResult.passed) {
    // 5. Stages 4–7: Sequential Action Execution Pipeline
    pipelineResult = await executeAutomationPipeline(
      workspaceId,
      execution.id,
      { actorContext: actor },
      db,
    );
  } else {
    pipelineResult = {
      executionId: execution.id,
      workspaceId,
      ruleId,
      ruleName: rule.name,
      status: AutomationExecutionStatus.SKIPPED,
      reasonCode: "CONDITIONS_NOT_MET",
      correlationId,
      executionDepth: 0,
      causalityChain: [],
      stepCount: 0,
      steps: [],
    };
  }


  return {
    success: true,
    ruleId,
    results: [pipelineResult],
  };
}


// ============================================================================
// EXECUTION INSPECTION SERVICES
// ============================================================================

/**
 * Lists AutomationExecution history with filtering and pagination.
 */
export async function listAutomationExecutions(
  workspaceId: string,
  query?: ListAutomationExecutionsQuery,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }

  // RBAC Check: AUTOMATIONS_VIEW (OWNER, ADMIN, MANAGER)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_VIEW);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  const page = Math.max(1, query?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query?.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const whereClause: Prisma.AutomationExecutionWhereInput = {
    workspaceId, // INVARIANT 1
    ...(query?.ruleId ? { ruleId: query.ruleId } : {}),
    ...(query?.status ? { status: query.status as AutomationExecutionStatus } : {}),
    ...(query?.fromDate || query?.toDate
      ? {
          createdAt: {
            ...(query?.fromDate ? { gte: new Date(query.fromDate) } : {}),
            ...(query?.toDate ? { lte: new Date(query.toDate) } : {}),
          },
        }
      : {}),
  };

  const sortBy = query?.sortBy ?? "createdAt";
  const sortOrder = query?.sortOrder ?? "desc";

  const [executions, total] = await Promise.all([
    db.automationExecution.findMany({
      where: whereClause,
      include: {
        rule: {
          select: { id: true, name: true },
        },
        _count: {
          select: { steps: true },
        },
      },
      skip,
      take: pageSize,
      orderBy: { [sortBy]: sortOrder },
    }),
    db.automationExecution.count({ where: whereClause }),
  ]);

  return {
    executions,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Retrieves full execution details including all sequential step traces.
 */
export async function getAutomationExecution(
  workspaceId: string,
  executionId: string,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }
  if (!executionId || typeof executionId !== "string") {
    throw new AutomationValidationError("Valid executionId is required");
  }

  // RBAC Check: AUTOMATIONS_VIEW (OWNER, ADMIN, MANAGER)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_VIEW);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  const execution = await db.automationExecution.findFirst({
    where: {
      id: executionId,
      workspaceId, // INVARIANT 1
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
      `AutomationExecution '${executionId}' not found in workspace '${workspaceId}'`,
    );
  }

  return execution;
}

// ============================================================================
// SCHEDULE JOB MANAGEMENT SERVICES
// ============================================================================

/**
 * Lists AutomationScheduleJobs with filtering.
 */
export async function listAutomationScheduleJobs(
  workspaceId: string,
  query?: ListScheduleJobsQuery,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }

  // RBAC Check: AUTOMATIONS_VIEW (OWNER, ADMIN, MANAGER)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_VIEW);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  const page = Math.max(1, query?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query?.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const whereClause: Prisma.AutomationScheduleJobWhereInput = {
    workspaceId, // INVARIANT 1
    ...(query?.ruleId ? { ruleId: query.ruleId } : {}),
    ...(query?.isActive !== undefined ? { isActive: query.isActive } : {}),
  };

  const [jobs, total] = await Promise.all([
    db.automationScheduleJob.findMany({
      where: whereClause,
      include: {
        rule: { select: { id: true, name: true, isEnabled: true } },
      },
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    db.automationScheduleJob.count({ where: whereClause }),
  ]);

  return {
    jobs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Toggles a schedule job active state.
 */
export async function toggleAutomationScheduleJob(
  workspaceId: string,
  jobId: string,
  isActive: boolean,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }
  if (!jobId || typeof jobId !== "string") {
    throw new AutomationValidationError("Valid jobId is required");
  }

  // 1. RBAC Check: AUTOMATIONS_MANAGE (OWNER, ADMIN)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_MANAGE);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  // 2. Entitlement Gate: FEATURE_AUTOMATIONS (Phase 1.15)
  await assertEntitlement(db, workspaceId, "FEATURE_AUTOMATIONS");

  const existing = await db.automationScheduleJob.findFirst({
    where: { id: jobId, workspaceId },
  });

  if (!existing) {
    throw new AutomationScheduleJobNotFoundError(
      `AutomationScheduleJob '${jobId}' not found in workspace '${workspaceId}'`,
    );
  }

  return db.automationScheduleJob.update({
    where: { id: jobId },
    data: { isActive },
  });
}

/**
 * Deletes a scheduled job.
 */
export async function deleteAutomationScheduleJob(
  workspaceId: string,
  jobId: string,
  actor?: WorkspaceAuthorizationContext,
  client?: DbClient,
) {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }
  if (!jobId || typeof jobId !== "string") {
    throw new AutomationValidationError("Valid jobId is required");
  }

  // 1. RBAC Check: AUTOMATIONS_MANAGE (OWNER, ADMIN)
  if (actor) {
    assertPermission(actor.membership.role, PERMISSIONS.AUTOMATIONS_MANAGE);
  }

  const db = (client ?? defaultPrisma) as PrismaClient;

  // 2. Entitlement Gate: FEATURE_AUTOMATIONS (Phase 1.15)
  await assertEntitlement(db, workspaceId, "FEATURE_AUTOMATIONS");

  const existing = await db.automationScheduleJob.findFirst({
    where: { id: jobId, workspaceId },
  });

  if (!existing) {
    throw new AutomationScheduleJobNotFoundError(
      `AutomationScheduleJob '${jobId}' not found in workspace '${workspaceId}'`,
    );
  }

  await db.automationScheduleJob.delete({
    where: { id: jobId },
  });

  return { success: true, deletedJobId: jobId };
}
