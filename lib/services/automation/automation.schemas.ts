/**
 * Phase 1.16.3 — Automation Zod Validation Schemas
 */

import { z } from "zod";
import {
  AutomationTriggerType,
  AutomationExecutionStatus,
  AutomationExecutionStepStatus,
  AutomationErrorPolicy,
  AutomationActionType,
  ConditionOperator,
  AutomationConditionLogicalOperator,
} from "@/generated/prisma/enums";

export const automationTriggerTypeSchema = z.nativeEnum(AutomationTriggerType);
export const automationExecutionStatusSchema = z.nativeEnum(AutomationExecutionStatus);
export const automationExecutionStepStatusSchema = z.nativeEnum(AutomationExecutionStepStatus);
export const automationErrorPolicySchema = z.nativeEnum(AutomationErrorPolicy);
export const automationActionTypeSchema = z.nativeEnum(AutomationActionType);
export const conditionOperatorSchema = z.nativeEnum(ConditionOperator);
export const automationConditionLogicalOperatorSchema = z.nativeEnum(AutomationConditionLogicalOperator);

export const ingestAutomationEventSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  eventType: z.string().min(1, "eventType is required"),
  sourceEntity: z.string().min(1, "sourceEntity is required"),
  sourceId: z.string().min(1, "sourceId is required"),
  payload: z.record(z.string(), z.unknown()).default({}),
  eventTimestamp: z.union([z.date(), z.string(), z.number()]).optional(),
  correlationId: z.string().max(128).optional(),
  parentExecutionId: z.string().nullable().optional(),
  causalityChain: z.array(z.string()).default([]),
  executionDepth: z.number().int().min(0).default(0),
  actorMemberId: z.string().nullable().optional(),
});

export type IngestAutomationEventSchemaType = z.infer<typeof ingestAutomationEventSchema>;
