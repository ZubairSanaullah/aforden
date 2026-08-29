/**
 * Phase 1.16.6 — Core Automation Execution Engine & State Machine
 *
 * Implements the sequential action execution pipeline, recursion pre-flight guards
 * (Invariant 8), error policy enforcement (Invariant 6), step output propagation (Invariant 3),
 * step/execution timeout guards, and append-only state finalization (Invariant 4).
 */

import { randomUUID } from "crypto";
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
  AutomationExecutionStatus,
  AutomationExecutionStepStatus,
  AutomationErrorPolicy,
  AutomationActionType,
} from "@/generated/prisma/enums";
import type {
  ActionExecutionContext,
  ExecutionEngineOptions,
  ExecutionPipelineResult,
  StepExecutionResult,
  ChildExecutionMetadata,
  IngestAutomationEventInput,
  ActionResult,
} from "./automation.types";
import {
  AutomationValidationError,
  AutomationRuleNotFoundError,
  AutomationExecutionAlreadyTerminalError,
  AutomationExecutionTimeoutError,
} from "./automationErrors";
import { executeAction } from "./actionRegistry";
import { ingestAutomationEvent } from "./eventIngestionService";
import { evaluateExecutionConditionsStage } from "./conditionEvaluatorService";
import { executeStepWithRetry } from "./retryEngine";

type DbClient = PrismaClient | Prisma.TransactionClient;

const DEFAULT_STEP_TIMEOUT_MS = 30000; // 30 seconds
const DEFAULT_MAX_EXECUTION_DEPTH = 3;

/**
 * Wraps a promise in a timeout guard.
 */
async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      const err: any = new Error(errorMessage);
      err.code = "EXECUTION_TIMEOUT";
      err.name = "AutomationExecutionTimeoutError";
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Computes child execution provenance metadata when an action triggers a downstream event.
 * Enforces Invariant 8 tracking: increments executionDepth, extends causalityChain with currentRuleId.
 *
 * @param context - The active ActionExecutionContext
 * @param currentRuleId - The rule ID of the parent action triggering downstream work
 */
export function computeChildExecutionMetadata(
  context: ActionExecutionContext | ChildExecutionMetadata | Record<string, unknown>,
  currentRuleId: string,
): ChildExecutionMetadata {
  const currentDepth = typeof context.executionDepth === "number" ? context.executionDepth : 0;
  const currentChain = Array.isArray(context.causalityChain) ? context.causalityChain : [];
  const parentExecId =
    ((context as any).executionId as string) ||
    ((context as any).parentExecutionId as string) ||
    "";
  const correlationId = ((context as any).correlationId as string) || randomUUID();

  return {
    parentExecutionId: parentExecId,
    executionDepth: currentDepth + 1,
    causalityChain: [...currentChain, currentRuleId],
    correlationId,
  };
}

/**
 * Executes the sequential action pipeline for an initialized `AutomationExecution`.
 *
 * Stages 4–7 Execution Flow:
 * 1. Resolves execution record scoped strictly to `workspaceId` (Invariant 1).
 * 2. Enforces append-only immutable state guard (Invariant 4).
 * 3. Pre-Flight Recursion & Cycle Guards (Invariant 8):
 *    - If `executionDepth > D_max (3)` -> `FAILED` (`MAX_EXECUTION_DEPTH_EXCEEDED`), 0 steps.
 *    - If `currentRuleId` in `causalityChain` -> `FAILED` (`RECURSIVE_CYCLE_DETECTED`), 0 steps.
 * 4. Transitions status from `PENDING` -> `RUNNING`.
 * 5. Sequentially executes `AutomationAction` records ordered by `stepOrder ASC` (Invariant 3).
 *    - Propagates step outputs into `context.stepOutputs` & `context.steps[N].output`.
 *    - Enforces step timeout ceiling.
 *    - Evaluates error policy on failure (`HALT_ON_ERROR` vs. `CONTINUE_ON_ERROR`).
 * 6. Finalizes terminal execution state and duration.
 */
export async function executeAutomationPipeline(
  workspaceId: string,
  executionId: string,
  options?: ExecutionEngineOptions,
  client?: DbClient,
): Promise<ExecutionPipelineResult> {
  const db = (client ?? defaultPrisma) as PrismaClient;
  const stepTimeoutMs = options?.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const maxDepth = options?.maxExecutionDepth ?? DEFAULT_MAX_EXECUTION_DEPTH;

  if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new AutomationValidationError("Valid workspaceId is required for pipeline execution");
  }

  if (!executionId || typeof executionId !== "string" || executionId.trim() === "") {
    throw new AutomationValidationError("Valid executionId is required for pipeline execution");
  }

  // 1. Fetch Execution and Rule (Strictly tenant scoped per Invariant 1)
  const execution = await db.automationExecution.findFirst({
    where: {
      id: executionId,
      workspaceId, // INVARIANT 1: Strict Workspace Scoping
    },
    include: {
      rule: {
        include: {
          actions: {
            orderBy: { stepOrder: "asc" },
          },
          trigger: true,
        },
      },
      steps: {
        orderBy: { stepOrder: "asc" },
      },
    },
  });

  if (!execution) {
    throw new AutomationRuleNotFoundError(
      `AutomationExecution '${executionId}' not found in workspace '${workspaceId}'`,
    );
  }

  // 2. Terminal State Guard (Invariant 4: Append-Only Immutable History)
  const terminalStatuses: AutomationExecutionStatus[] = [
    AutomationExecutionStatus.COMPLETED,
    AutomationExecutionStatus.FAILED,
    AutomationExecutionStatus.SKIPPED,
    AutomationExecutionStatus.TIMED_OUT,
    AutomationExecutionStatus.CANCELED,
  ];

  if (terminalStatuses.includes(execution.status)) {
    throw new AutomationExecutionAlreadyTerminalError(
      execution.id,
      execution.status,
    );
  }

  const executionStart = options?.now ?? new Date();

  // 3. Stage 4: Pre-Flight Recursion & Cycle Guards (Invariant 8)
  // 3a. Execution Depth Ceiling (D > 3 -> FAILED / MAX_EXECUTION_DEPTH_EXCEEDED)
  if (execution.executionDepth > maxDepth) {
    const finalized = await db.automationExecution.update({
      where: { id: execution.id },
      data: {
        status: AutomationExecutionStatus.FAILED,
        reasonCode: "MAX_EXECUTION_DEPTH_EXCEEDED",
        errorJson: {
          code: "MAX_EXECUTION_DEPTH_EXCEEDED",
          message: `Execution depth ${execution.executionDepth} exceeds maximum allowed ceiling of ${maxDepth}`,
          executionDepth: execution.executionDepth,
          maxDepth,
        },
        startedAt: executionStart,
        completedAt: executionStart,
        durationMs: 0,
      },
    });

    return {
      executionId: finalized.id,
      workspaceId,
      ruleId: execution.ruleId,
      ruleName: execution.rule?.name,
      status: AutomationExecutionStatus.FAILED,
      reasonCode: "MAX_EXECUTION_DEPTH_EXCEEDED",
      correlationId: execution.correlationId,
      executionDepth: execution.executionDepth,
      causalityChain: execution.causalityChain,
      stepCount: 0,
      steps: [],
      startedAt: executionStart,
      completedAt: finalized.completedAt,
      durationMs: 0,
      errorJson: finalized.errorJson,
    };
  }

  // 3b. Causality Chain Cycle Detection (ruleId already in causalityChain -> FAILED / RECURSIVE_CYCLE_DETECTED)
  if (execution.ruleId && execution.causalityChain.includes(execution.ruleId)) {
    const finalized = await db.automationExecution.update({
      where: { id: execution.id },
      data: {
        status: AutomationExecutionStatus.FAILED,
        reasonCode: "RECURSIVE_CYCLE_DETECTED",
        errorJson: {
          code: "RECURSIVE_CYCLE_DETECTED",
          message: `Recursive automation cycle detected for rule '${execution.ruleId}' in causality chain [${execution.causalityChain.join(" -> ")}]`,
          ruleId: execution.ruleId,
          causalityChain: execution.causalityChain,
        },
        startedAt: executionStart,
        completedAt: executionStart,
        durationMs: 0,
      },
    });

    return {
      executionId: finalized.id,
      workspaceId,
      ruleId: execution.ruleId,
      ruleName: execution.rule?.name,
      status: AutomationExecutionStatus.FAILED,
      reasonCode: "RECURSIVE_CYCLE_DETECTED",
      correlationId: execution.correlationId,
      executionDepth: execution.executionDepth,
      causalityChain: execution.causalityChain,
      stepCount: 0,
      steps: [],
      startedAt: executionStart,
      completedAt: finalized.completedAt,
      durationMs: 0,
      errorJson: finalized.errorJson,
    };
  }

  // 4. Transition Execution to RUNNING
  await db.automationExecution.update({
    where: { id: execution.id },
    data: {
      status: AutomationExecutionStatus.RUNNING,
      startedAt: executionStart,
    },
  });

  // 5. Stage 5: Sequential Action Execution Pipeline
  const stepOutputs: Record<number, Record<string, unknown>> = {};
  const stepsContext: Record<string, { output?: Record<string, unknown>; [key: string]: unknown }> = {};
  const stepRecords: StepExecutionResult[] = [];

  const executionContext: ActionExecutionContext = {
    workspaceId,
    correlationId: execution.correlationId,
    parentExecutionId: execution.parentExecutionId,
    executionDepth: execution.executionDepth,
    causalityChain: execution.causalityChain,
    actorMemberId: null,
    ruleId: execution.ruleId,
    ruleName: execution.rule?.name,
    executionId: execution.id,
    trigger: {
      type: execution.rule?.trigger?.triggerType,
      eventType: execution.rule?.trigger?.eventType,
      payload: (execution.triggerPayloadJson as Record<string, unknown>) || {},
    },
    steps: stepsContext,
    stepOutputs,
    metadata: {},
    actorContext: options?.actorContext,
    prismaTx: options?.prismaTx,
  };

  const actions = execution.rule?.actions ?? [];

  for (const action of actions) {
    const stepStart = new Date();

    // 5a. Create AutomationExecutionStep in RUNNING
    const step = await db.automationExecutionStep.create({
      data: {
        workspaceId, // INVARIANT 1
        executionId: execution.id,
        stepOrder: action.stepOrder,
        actionType: action.actionType,
        status: AutomationExecutionStepStatus.RUNNING,
        inputJson: action.paramsJson as Prisma.InputJsonValue,
        startedAt: stepStart,
      },
    });

    executionContext.stepOrder = action.stepOrder;

    let actionResult: ActionResult;
    let stepDurationMs = 0;
    let isTimedOut = false;
    let attemptCount = 1;
    let retriesExhausted = false;

    try {
      const retryOutcome = await executeStepWithRetry(
        async () => {
          return executeWithTimeout(
            executeAction(action.actionType, action.paramsJson, executionContext),
            stepTimeoutMs,
            `Step ${action.stepOrder} (${action.actionType}) timed out after ${stepTimeoutMs}ms`,
          );
        },
        executionContext,
        options?.retryConfig,
      );

      actionResult = retryOutcome.result;
      attemptCount = retryOutcome.attemptCount;
      retriesExhausted = retryOutcome.retriesExhausted;
      if (actionResult.error?.code === "EXECUTION_TIMEOUT") {
        isTimedOut = true;
      }
    } catch (err: any) {
      if (err.code === "EXECUTION_TIMEOUT") {
        isTimedOut = true;
      }
      actionResult = {
        success: false,
        error: {
          code: err.code || err.name || "ACTION_EXECUTION_ERROR",
          message: err.message || "Action step execution failed",
          details: err.details,
          stack: err.stack,
        },
      };
    }

    stepDurationMs = Date.now() - stepStart.getTime();
    const stepCompletedAt = new Date();

    // 5b. Handle Step TIMED_OUT
    if (isTimedOut) {
      const errorJson = {
        ...(actionResult.error || {
          code: "EXECUTION_TIMEOUT",
          message: `Step ${action.stepOrder} timed out after ${stepTimeoutMs}ms`,
        }),
        attempts: attemptCount,
        isDeadLetter: true,
        failedStepOrder: action.stepOrder,
        failedActionType: action.actionType,
      };

      const finalizedStep = await db.automationExecutionStep.update({
        where: { id: step.id },
        data: {
          status: AutomationExecutionStepStatus.TIMED_OUT,
          errorJson: errorJson as Prisma.InputJsonValue,
          durationMs: stepDurationMs,
          completedAt: stepCompletedAt,
        },
      });

      stepRecords.push({
        stepId: finalizedStep.id,
        stepOrder: action.stepOrder,
        actionType: action.actionType,
        status: AutomationExecutionStepStatus.TIMED_OUT,
        inputJson: action.paramsJson,
        errorJson,
        durationMs: stepDurationMs,
        startedAt: stepStart,
        completedAt: stepCompletedAt,
      });

      const totalDurationMs = Date.now() - executionStart.getTime();
      const finalizedExecution = await db.automationExecution.update({
        where: { id: execution.id },
        data: {
          status: AutomationExecutionStatus.TIMED_OUT,
          reasonCode: "EXECUTION_TIMEOUT",
          errorJson: errorJson as Prisma.InputJsonValue,
          durationMs: totalDurationMs,
          completedAt: stepCompletedAt,
        },
      });

      return {
        executionId: finalizedExecution.id,
        workspaceId,
        ruleId: execution.ruleId,
        ruleName: execution.rule?.name,
        status: AutomationExecutionStatus.TIMED_OUT,
        reasonCode: "EXECUTION_TIMEOUT",
        correlationId: execution.correlationId,
        executionDepth: execution.executionDepth,
        causalityChain: execution.causalityChain,
        stepCount: stepRecords.length,
        steps: stepRecords,
        startedAt: executionStart,
        completedAt: finalizedExecution.completedAt,
        durationMs: totalDurationMs,
        errorJson,
      };
    }

    // 5c. Handle Step Success
    if (actionResult.success) {
      const outputData = (actionResult.data ?? {}) as Record<string, unknown>;

      const finalizedStep = await db.automationExecutionStep.update({
        where: { id: step.id },
        data: {
          status: AutomationExecutionStepStatus.COMPLETED,
          outputJson: outputData as Prisma.InputJsonValue,
          durationMs: stepDurationMs,
          completedAt: stepCompletedAt,
        },
      });

      stepRecords.push({
        stepId: finalizedStep.id,
        stepOrder: action.stepOrder,
        actionType: action.actionType,
        status: AutomationExecutionStepStatus.COMPLETED,
        inputJson: action.paramsJson,
        outputJson: outputData,
        durationMs: stepDurationMs,
        startedAt: stepStart,
        completedAt: stepCompletedAt,
      });

      // Context Propagation (Invariant 3)
      stepOutputs[action.stepOrder] = outputData;
      stepsContext[String(action.stepOrder)] = { output: outputData };
    } else {
      // 5d. Handle Step Failure
      const failureReasonCode = retriesExhausted
        ? "RETRIES_EXHAUSTED"
        : actionResult.error?.code || "DOMAIN_SERVICE_ERROR";

      const errorJson = {
        ...(actionResult.error || {
          code: failureReasonCode,
          message: "Step execution failed",
        }),
        code: failureReasonCode,
        attempts: attemptCount,
        isDeadLetter: true,
        failedStepOrder: action.stepOrder,
        failedActionType: action.actionType,
      };

      const finalizedStep = await db.automationExecutionStep.update({
        where: { id: step.id },
        data: {
          status: AutomationExecutionStepStatus.FAILED,
          errorJson: errorJson as Prisma.InputJsonValue,
          durationMs: stepDurationMs,
          completedAt: stepCompletedAt,
        },
      });

      stepRecords.push({
        stepId: finalizedStep.id,
        stepOrder: action.stepOrder,
        actionType: action.actionType,
        status: AutomationExecutionStepStatus.FAILED,
        inputJson: action.paramsJson,
        errorJson,
        durationMs: stepDurationMs,
        startedAt: stepStart,
        completedAt: stepCompletedAt,
      });

      // Error Policy Enforcement (Invariant 6)
      const errorPolicy = execution.rule?.errorPolicy || AutomationErrorPolicy.HALT_ON_ERROR;

      if (errorPolicy === AutomationErrorPolicy.HALT_ON_ERROR) {
        const totalDurationMs = Date.now() - executionStart.getTime();
        const finalizedExecution = await db.automationExecution.update({
          where: { id: execution.id },
          data: {
            status: AutomationExecutionStatus.FAILED,
            reasonCode: failureReasonCode,
            errorJson: errorJson as Prisma.InputJsonValue,
            durationMs: totalDurationMs,
            completedAt: stepCompletedAt,
          },
        });

        return {
          executionId: finalizedExecution.id,
          workspaceId,
          ruleId: execution.ruleId,
          ruleName: execution.rule?.name,
          status: AutomationExecutionStatus.FAILED,
          reasonCode: failureReasonCode,
          correlationId: execution.correlationId,
          executionDepth: execution.executionDepth,
          causalityChain: execution.causalityChain,
          stepCount: stepRecords.length,
          steps: stepRecords,
          startedAt: executionStart,
          completedAt: finalizedExecution.completedAt,
          durationMs: totalDurationMs,
          errorJson,
        };
      }

      // If CONTINUE_ON_ERROR: keep executing subsequent steps (step outputs remain empty)
    }
  }

  // 6. Stage 6 & 7: Finalize Execution Record to COMPLETED
  const totalDurationMs = Date.now() - executionStart.getTime();
  const finalizedExecution = await db.automationExecution.update({
    where: { id: execution.id },
    data: {
      status: AutomationExecutionStatus.COMPLETED,
      durationMs: totalDurationMs,
      completedAt: new Date(),
    },
  });

  return {
    executionId: finalizedExecution.id,
    workspaceId,
    ruleId: execution.ruleId,
    ruleName: execution.rule?.name,
    status: AutomationExecutionStatus.COMPLETED,
    reasonCode: null,
    correlationId: execution.correlationId,
    executionDepth: execution.executionDepth,
    causalityChain: execution.causalityChain,
    stepCount: stepRecords.length,
    steps: stepRecords,
    startedAt: executionStart,
    completedAt: finalizedExecution.completedAt,
    durationMs: totalDurationMs,
  };
}

/**
 * High-level workflow orchestrator connecting all 7 stages:
 * Stage 1 (Ingestion Deduplication) -> Stage 2 (Entitlement & Rule Matching) ->
 * Stage 3 (Condition Evaluation) -> Stage 4-7 (Sequential Pipeline Execution).
 *
 * @param workspaceId - Target tenant workspace identifier
 * @param input - Event envelope payload
 * @param options - Execution engine configuration options
 * @param client - Optional Prisma database client
 */
export async function runAutomationWorkflow(
  workspaceId: string,
  input: IngestAutomationEventInput,
  options?: ExecutionEngineOptions,
  client?: DbClient,
): Promise<ExecutionPipelineResult[]> {
  const db = client ?? defaultPrisma;

  // 1. Stage 1 & 2: Ingest and match rules
  const ingestionResult = await ingestAutomationEvent(workspaceId, input, db);

  if (
    ingestionResult.outcome !== "MATCHED" ||
    ingestionResult.createdExecutionIds.length === 0
  ) {
    return [];
  }

  const results: ExecutionPipelineResult[] = [];

  // 2. Iterate through each created PENDING execution
  for (const execId of ingestionResult.createdExecutionIds) {
    // 3. Stage 3: Evaluate Conditions
    const conditionResult = await evaluateExecutionConditionsStage(
      db,
      workspaceId,
      execId,
      options?.now,
    );

    if (!conditionResult.passed) {
      // Short-circuited to SKIPPED / CONDITIONS_NOT_MET
      continue;
    }

    // 4. Stage 4–7: Sequential Action Execution Pipeline
    const pipelineResult = await executeAutomationPipeline(
      workspaceId,
      execId,
      options,
      db,
    );
    results.push(pipelineResult);
  }

  return results;
}
