/**
 * Phase 1.16.3 — Automation Domain Error Classes
 * Defines standard error hierarchy for automation operations.
 */

export class AutomationError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = "AUTOMATION_ERROR", statusCode = 400) {
    super(message);
    this.name = "AutomationError";
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AutomationValidationError extends AutomationError {
  public readonly fieldErrors?: Record<string, string[]>;

  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message, "AUTOMATION_VALIDATION_ERROR", 400);
    this.name = "AutomationValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export class AutomationCrossTenantLeakageError extends AutomationError {
  constructor(message = "Cross-tenant access in automation domain is strictly prohibited") {
    super(message, "CROSS_TENANT_LEAKAGE_DETECTED", 403);
    this.name = "AutomationCrossTenantLeakageError";
  }
}

export class AutomationDuplicateEventError extends AutomationError {
  public readonly dedupeKey: string;

  constructor(dedupeKey: string, message = "Duplicate event ingestion detected within deduplication window") {
    super(message, "DUPLICATE_INGESTION_EVENT", 409);
    this.name = "AutomationDuplicateEventError";
    this.dedupeKey = dedupeKey;
  }
}

export class AutomationEntitlementInactiveError extends AutomationError {
  constructor(message = "Workspace does not have an active entitlement for automated workflows") {
    super(message, "ENTITLEMENT_INACTIVE", 403);
    this.name = "AutomationEntitlementInactiveError";
  }
}

export class AutomationRuleNotFoundError extends AutomationError {
  constructor(ruleId: string) {
    super(`Automation rule '${ruleId}' was not found`, "AUTOMATION_RULE_NOT_FOUND", 404);
    this.name = "AutomationRuleNotFoundError";
  }
}

export class AutomationInvalidTriggerTypeError extends AutomationError {
  public readonly invalidType: string;

  constructor(invalidType: string) {
    super(`'${invalidType}' is not a valid AutomationTriggerType`, "INVALID_TRIGGER_TYPE", 400);
    this.name = "AutomationInvalidTriggerTypeError";
    this.invalidType = invalidType;
  }
}

export class AutomationInvalidActionTypeError extends AutomationError {
  public readonly invalidType: string;

  constructor(invalidType: string) {
    super(`'${invalidType}' is not a valid AutomationActionType`, "INVALID_ACTION_TYPE", 400);
    this.name = "AutomationInvalidActionTypeError";
    this.invalidType = invalidType;
  }
}

export class AutomationActionParamValidationError extends AutomationError {
  public readonly actionType: string;
  public readonly fieldErrors?: Record<string, string[]>;

  constructor(actionType: string, message: string, fieldErrors?: Record<string, string[]>) {
    super(message, "ACTION_PARAM_VALIDATION_ERROR", 400);
    this.name = "AutomationActionParamValidationError";
    this.actionType = actionType;
    this.fieldErrors = fieldErrors;
  }
}

export class AutomationActionExecutionError extends AutomationError {
  public readonly actionType: string;
  public readonly details?: unknown;

  constructor(actionType: string, message: string, details?: unknown, statusCode = 500) {
    super(message, "ACTION_EXECUTION_ERROR", statusCode);
    this.name = "AutomationActionExecutionError";
    this.actionType = actionType;
    this.details = details;
  }
}

export class AutomationExecutionAlreadyTerminalError extends AutomationError {
  public readonly executionId: string;
  public readonly currentStatus: string;

  constructor(executionId: string, currentStatus: string) {
    super(
      `AutomationExecution '${executionId}' is already in terminal state '${currentStatus}' and cannot be mutated`,
      "EXECUTION_ALREADY_TERMINAL",
      409
    );
    this.name = "AutomationExecutionAlreadyTerminalError";
    this.executionId = executionId;
    this.currentStatus = currentStatus;
  }
}

export class AutomationExecutionTimeoutError extends AutomationError {
  public readonly executionId: string;
  public readonly stepOrder?: number;
  public readonly timeoutMs: number;

  constructor(executionId: string, timeoutMs: number, stepOrder?: number) {
    super(
      stepOrder !== undefined
        ? `Execution '${executionId}' step ${stepOrder} timed out after ${timeoutMs}ms`
        : `Execution '${executionId}' timed out after ${timeoutMs}ms`,
      "EXECUTION_TIMEOUT",
      408
    );
    this.name = "AutomationExecutionTimeoutError";
    this.executionId = executionId;
    this.stepOrder = stepOrder;
    this.timeoutMs = timeoutMs;
  }
}

export class AutomationExecutionHaltedError extends AutomationError {
  public readonly executionId: string;
  public readonly stepOrder: number;
  public readonly reason: string;

  constructor(executionId: string, stepOrder: number, reason: string) {
    super(
      `Execution '${executionId}' halted at step ${stepOrder} due to error: ${reason}`,
      "EXECUTION_HALTED",
      422
    );
    this.name = "AutomationExecutionHaltedError";
    this.executionId = executionId;
    this.stepOrder = stepOrder;
    this.reason = reason;
  }
}

export class AutomationMaxExecutionDepthExceededError extends AutomationError {
  public readonly executionDepth: number;
  public readonly maxDepth: number;

  constructor(executionDepth: number, maxDepth = 3) {
    super(
      `Execution depth ${executionDepth} exceeds maximum allowed ceiling of ${maxDepth}`,
      "MAX_EXECUTION_DEPTH_EXCEEDED",
      422
    );
    this.name = "AutomationMaxExecutionDepthExceededError";
    this.executionDepth = executionDepth;
    this.maxDepth = maxDepth;
  }
}

export class AutomationRecursiveCycleDetectedError extends AutomationError {
  public readonly ruleId: string;
  public readonly causalityChain: string[];

  constructor(ruleId: string, causalityChain: string[]) {
    super(
      `Recursive automation cycle detected for rule '${ruleId}'. Causality chain: [${causalityChain.join(" -> ")}]`,
      "RECURSIVE_CYCLE_DETECTED",
      422
    );
    this.name = "AutomationRecursiveCycleDetectedError";
    this.ruleId = ruleId;
    this.causalityChain = causalityChain;
  }
}

export class AutomationInvalidCronExpressionError extends AutomationError {
  public readonly cronExpression: string;

  constructor(cronExpression: string, reason?: string) {
    super(
      reason
        ? `Invalid cron expression '${cronExpression}': ${reason}`
        : `Invalid cron expression '${cronExpression}'`,
      "INVALID_CRON_EXPRESSION",
      400
    );
    this.name = "AutomationInvalidCronExpressionError";
    this.cronExpression = cronExpression;
  }
}

export class AutomationScheduleJobNotFoundError extends AutomationError {
  public readonly jobId: string;

  constructor(jobId: string) {
    super(`AutomationScheduleJob '${jobId}' not found`, "SCHEDULE_JOB_NOT_FOUND", 404);
    this.name = "AutomationScheduleJobNotFoundError";
    this.jobId = jobId;
  }
}

export class AutomationExecutionNotFoundError extends AutomationError {
  public readonly executionId: string;

  constructor(executionId: string) {
    super(`AutomationExecution '${executionId}' not found`, "AUTOMATION_EXECUTION_NOT_FOUND", 404);
    this.name = "AutomationExecutionNotFoundError";
    this.executionId = executionId;
  }
}

export class AutomationTriggerNotFoundError extends AutomationError {
  public readonly triggerId: string;

  constructor(triggerId: string) {
    super(`AutomationTrigger '${triggerId}' not found`, "AUTOMATION_TRIGGER_NOT_FOUND", 404);
    this.name = "AutomationTriggerNotFoundError";
    this.triggerId = triggerId;
  }
}

export class AutomationConditionGroupNotFoundError extends AutomationError {
  public readonly conditionGroupId: string;

  constructor(conditionGroupId: string) {
    super(`AutomationConditionGroup '${conditionGroupId}' not found`, "CONDITION_GROUP_NOT_FOUND", 404);
    this.name = "AutomationConditionGroupNotFoundError";
    this.conditionGroupId = conditionGroupId;
  }
}

export class AutomationActionNotFoundError extends AutomationError {
  public readonly actionId: string;

  constructor(actionId: string) {
    super(`AutomationAction '${actionId}' not found`, "AUTOMATION_ACTION_NOT_FOUND", 404);
    this.name = "AutomationActionNotFoundError";
    this.actionId = actionId;
  }
}

export class AutomationEntityOffsetResolutionError extends AutomationError {
  public readonly entityType: string;
  public readonly entityId: string;
  public readonly fieldName: string;

  constructor(entityType: string, entityId: string, fieldName: string, message?: string) {
    super(
      message ||
        `Failed to resolve date field '${fieldName}' for entity '${entityType}' with id '${entityId}'`,
      "ENTITY_OFFSET_RESOLUTION_ERROR",
      422
    );
    this.name = "AutomationEntityOffsetResolutionError";
    this.entityType = entityType;
    this.entityId = entityId;
    this.fieldName = fieldName;
  }
}

export class AutomationAuthorizationError extends AutomationError {
  constructor(message = "Insufficient permissions for automation operation") {
    super(message, "AUTOMATION_FORBIDDEN", 403);
    this.name = "AutomationAuthorizationError";
  }
}

