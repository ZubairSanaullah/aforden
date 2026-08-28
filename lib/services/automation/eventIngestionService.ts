/**
 * Phase 1.16.3 — Event Ingestion Service
 *
 * Primary entry point into Aforden's Automation & Workflow domain from domain outboxes
 * and operational services. Enforces Tier 1 Ingestion Deduplication, Tenant Isolation,
 * Entitlement Verification, and Trigger Matching.
 */

import { randomUUID } from "crypto";
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { AutomationExecutionStatus } from "@/generated/prisma/enums";
import type {
  IngestAutomationEventInput,
  AutomationIngestionResult,
} from "./automation.types";
import { ingestAutomationEventSchema } from "./automation.schemas";
import {
  AutomationValidationError,
  AutomationCrossTenantLeakageError,
} from "./automationErrors";
import { mapEventNameToTriggerType } from "./eventCatalogRegistry";
import {
  computeIngestionDedupeKey,
  checkAndRecordIngestionDedupe,
  checkAndRecordIngestionDedupeAsync,
} from "./ingestionDeduplication";
import {
  checkAutomationEntitlement,
  findMatchingRules,
} from "./triggerMatcherService";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Ingests a domain event into the automation engine.
 *
 * Lifecycle flow (Stages 1–2 of Phase 1.16.1 Architecture):
 * 1. Input validation & workspace verification.
 * 2. Stage 1: Tier 1 Deduplication (SHA-256 hash across rolling 5-minute window).
 * 3. Stage 2: Workspace Entitlement verification (`FEATURE_AUTOMATIONS`).
 * 4. Stage 2: Trigger matching scoped strictly by `workspaceId` (Invariant 1).
 * 5. Creates initial `AutomationExecution` record(s) in `PENDING` (or `SKIPPED` terminal state).
 *
 * @param workspaceId - Tenant workspace identifier (Invariant 1)
 * @param input - Event envelope containing eventType, sourceEntity, sourceId, payload, etc.
 * @param client - Optional Prisma client / transaction client
 */
export async function ingestAutomationEvent(
  workspaceId: string,
  input: IngestAutomationEventInput,
  client?: DbClient
): Promise<AutomationIngestionResult> {
  const db = client ?? defaultPrisma;

  // 1. Validation & Tenant Scoping Assertions
  if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new AutomationValidationError("Valid workspaceId is required for event ingestion");
  }

  if (input.workspaceId && input.workspaceId !== workspaceId) {
    throw new AutomationCrossTenantLeakageError(
      `Payload workspaceId '${input.workspaceId}' does not match context workspaceId '${workspaceId}'`
    );
  }

  const parseResult = ingestAutomationEventSchema.safeParse({
    ...input,
    workspaceId,
  });

  if (!parseResult.success) {
    throw new AutomationValidationError(
      "Invalid event envelope payload",
      parseResult.error.flatten().fieldErrors
    );
  }

  const validated = parseResult.data;
  const correlationId = validated.correlationId || randomUUID();
  const canonicalTriggerType = mapEventNameToTriggerType(validated.eventType);

  // 2. Stage 1: Tier 1 Ingestion Deduplication (Invariant 5)
  const dedupeKey = computeIngestionDedupeKey(
    workspaceId,
    validated.eventType,
    validated.sourceEntity,
    validated.sourceId,
    validated.eventTimestamp
  );

  const dedupeCheck = await checkAndRecordIngestionDedupeAsync(workspaceId, dedupeKey, db);
  if (dedupeCheck.isDuplicate) {
    // Drop event at ingestion — per Section 2.3 Short-Circuit Matrix: No execution record created
    return {
      outcome: "DROPPED_DUPLICATE",
      workspaceId,
      eventType: validated.eventType,
      canonicalTriggerType,
      dedupeKey,
      isDuplicate: true,
      isEntitled: true,
      matchedRuleCount: 0,
      createdExecutionIds: [],
      reasonCode: "DUPLICATE_INGESTION_EVENT",
    };
  }

  // 3. Stage 2: Entitlement & Trigger Matching (Invariant 1)
  const isEntitled = await checkAutomationEntitlement(db, workspaceId);
  const { enabledRules, disabledRules, allMatchingRules } = await findMatchingRules(
    db,
    workspaceId,
    validated.eventType,
    canonicalTriggerType
  );

  // 4. Handle Inactive Entitlement (Short-circuit to SKIPPED / ENTITLEMENT_INACTIVE)
  if (!isEntitled) {
    if (allMatchingRules.length === 0) {
      return {
        outcome: "NO_MATCH",
        workspaceId,
        eventType: validated.eventType,
        canonicalTriggerType,
        dedupeKey,
        isDuplicate: false,
        isEntitled: false,
        matchedRuleCount: 0,
        createdExecutionIds: [],
      };
    }

    const skippedExecutionIds: string[] = [];
    for (const rule of allMatchingRules) {
      const execution = await (db as PrismaClient).automationExecution.create({
        data: {
          workspaceId, // INVARIANT 1
          ruleId: rule.id,
          status: AutomationExecutionStatus.SKIPPED,
          correlationId,
          parentExecutionId: validated.parentExecutionId ?? null,
          causalityChain: validated.causalityChain,
          executionDepth: validated.executionDepth,
          triggerPayloadJson: validated.payload as Prisma.InputJsonValue,
          dedupeKey,
          reasonCode: "ENTITLEMENT_INACTIVE",
          startedAt: new Date(),
          completedAt: new Date(),
          durationMs: 0,
        },
        select: { id: true },
      });
      skippedExecutionIds.push(execution.id);
    }

    return {
      outcome: "SKIPPED",
      workspaceId,
      eventType: validated.eventType,
      canonicalTriggerType,
      dedupeKey,
      isDuplicate: false,
      isEntitled: false,
      matchedRuleCount: allMatchingRules.length,
      createdExecutionIds: skippedExecutionIds,
      reasonCode: "ENTITLEMENT_INACTIVE",
    };
  }

  // 5. Handle Disabled Rules (Short-circuit to SKIPPED / RULE_DISABLED)
  const disabledExecutionIds: string[] = [];
  for (const rule of disabledRules) {
    const execution = await (db as PrismaClient).automationExecution.create({
      data: {
        workspaceId, // INVARIANT 1
        ruleId: rule.id,
        status: AutomationExecutionStatus.SKIPPED,
        correlationId,
        parentExecutionId: validated.parentExecutionId ?? null,
        causalityChain: validated.causalityChain,
        executionDepth: validated.executionDepth,
        triggerPayloadJson: validated.payload as Prisma.InputJsonValue,
        dedupeKey,
        reasonCode: "RULE_DISABLED",
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
      },
      select: { id: true },
    });
    disabledExecutionIds.push(execution.id);
  }

  // 6. Handle No Enabled Rules Matched
  if (enabledRules.length === 0) {
    if (disabledRules.length > 0) {
      return {
        outcome: "SKIPPED",
        workspaceId,
        eventType: validated.eventType,
        canonicalTriggerType,
        dedupeKey,
        isDuplicate: false,
        isEntitled: true,
        matchedRuleCount: 0,
        createdExecutionIds: disabledExecutionIds,
        reasonCode: "RULE_DISABLED",
      };
    }

    return {
      outcome: "NO_MATCH",
      workspaceId,
      eventType: validated.eventType,
      canonicalTriggerType,
      dedupeKey,
      isDuplicate: false,
      isEntitled: true,
      matchedRuleCount: 0,
      createdExecutionIds: [],
    };
  }

  // 7. Stage 2 Handoff: Create Initial PENDING Execution Record(s)
  const pendingExecutionIds: string[] = [];
  for (const rule of enabledRules) {
    const execution = await (db as PrismaClient).automationExecution.create({
      data: {
        workspaceId, // INVARIANT 1
        ruleId: rule.id,
        status: AutomationExecutionStatus.PENDING,
        correlationId,
        parentExecutionId: validated.parentExecutionId ?? null,
        causalityChain: validated.causalityChain,
        executionDepth: validated.executionDepth,
        triggerPayloadJson: validated.payload as Prisma.InputJsonValue,
        dedupeKey,
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
      select: { id: true },
    });
    pendingExecutionIds.push(execution.id);
  }

  return {
    outcome: "MATCHED",
    workspaceId,
    eventType: validated.eventType,
    canonicalTriggerType,
    dedupeKey,
    isDuplicate: false,
    isEntitled: true,
    matchedRuleCount: enabledRules.length,
    createdExecutionIds: pendingExecutionIds,
  };
}
