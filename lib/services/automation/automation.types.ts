/**
 * Phase 1.16.3 — Automation Domain Types
 * Defines the canonical types and interfaces for trigger ingestion, deduplication, and event matching.
 */

import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import type {
  AutomationTriggerType,
  AutomationExecutionStatus,
  AutomationExecutionStepStatus,
  AutomationErrorPolicy,
  AutomationActionType,
  ConditionOperator,
  AutomationConditionLogicalOperator,
  MembershipRole,
} from "@/generated/prisma/enums";

export type {
  AutomationTriggerType,
  AutomationExecutionStatus,
  AutomationExecutionStepStatus,
  AutomationErrorPolicy,
  AutomationActionType,
  ConditionOperator,
  AutomationConditionLogicalOperator,
};

/**
 * Raw domain event envelope accepted by the automation ingestion service.
 * This is the sole entry point into the automation domain from upstream systems.
 */
export interface IngestAutomationEventInput {
  workspaceId: string;
  eventType: AutomationTriggerType | string;
  sourceEntity: string;
  sourceId: string;
  payload: Record<string, unknown>;
  eventTimestamp?: Date | string | number;
  correlationId?: string;
  parentExecutionId?: string | null;
  causalityChain?: string[];
  executionDepth?: number;
  actorMemberId?: string | null;
}

/**
 * Outcome categorization for the ingestion pipeline.
 */
export type AutomationIngestionOutcome =
  | "MATCHED"
  | "SKIPPED"
  | "DROPPED_DUPLICATE"
  | "NO_MATCH";

/**
 * Result returned by the event ingestion service.
 */
export interface AutomationIngestionResult {
  outcome: AutomationIngestionOutcome;
  workspaceId: string;
  eventType: string;
  canonicalTriggerType: AutomationTriggerType | null;
  dedupeKey: string;
  isDuplicate: boolean;
  isEntitled: boolean;
  matchedRuleCount: number;
  createdExecutionIds: string[];
  reasonCode?: string | null;
  error?: string;
}

/**
 * Result of the Tier 1 ingestion deduplication check.
 */
export interface IngestionDedupeResult {
  dedupeKey: string;
  isDuplicate: boolean;
}

/**
 * Candidate matched rule summary.
 */
export interface MatchedRuleSummary {
  ruleId: string;
  ruleName: string;
  isEnabled: boolean;
  errorPolicy: AutomationErrorPolicy;
  triggerType: AutomationTriggerType;
  actionCount: number;
}

/**
 * Phase 1.16.4 — ExecutionContext interface representing runtime state
 * available to condition evaluation and action step pipelines.
 */
export interface ExecutionContext {
  workspaceId: string;
  ruleId?: string | null;
  executionId?: string | null;
  trigger: {
    type?: AutomationTriggerType | string | null;
    eventType?: string | null;
    payload: Record<string, unknown>;
  };
  steps?: Record<string, { output?: Record<string, unknown>; [key: string]: unknown }>;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  executionDepth?: number;
  [key: string]: unknown;
}

/**
 * Data structure for a single leaf Automation Condition.
 */
export interface AutomationConditionData {
  id?: string;
  fieldPath: string;
  operator: ConditionOperator;
  targetValueJson?: unknown;
  valueType?: string | null;
}

/**
 * Data structure for a hierarchical Automation Condition Group.
 */
export interface AutomationConditionGroupData {
  id?: string;
  logicalOperator: AutomationConditionLogicalOperator;
  conditions?: AutomationConditionData[];
  childGroups?: AutomationConditionGroupData[];
}

/**
 * Result of condition evaluation for a rule.
 */
export interface ConditionEvaluationResult {
  passed: boolean;
  reasonCode?: string | null;
  evaluatedConditionCount: number;
}

/**
 * Result returned by Stage 3 Condition Evaluation Service.
 */
export interface ConditionStageResult {
  executionId: string;
  workspaceId: string;
  passed: boolean;
  status: AutomationExecutionStatus;
  reasonCode?: string | null;
}

/**
 * Phase 1.16.5 — ActionExecutionContext
 * Execution state and provenance passed to ActionHandler instances.
 */
export interface ActionExecutionContext {
  workspaceId: string;
  correlationId: string;
  parentExecutionId?: string | null;
  executionDepth: number;
  causalityChain: string[];
  actorMemberId?: string | null;
  ruleId?: string | null;
  ruleName?: string | null;
  executionId?: string | null;
  stepOrder?: number;
  trigger: {
    id?: string | null;
    type?: AutomationTriggerType | string | null;
    triggerType?: AutomationTriggerType | string | null;
    eventType?: string | null;
    sourceEntity?: string | null;
    sourceId?: string | null;
    payload: Record<string, unknown>;
    [key: string]: unknown;
  };
  steps?: Record<string, { output?: Record<string, unknown>; [key: string]: unknown }>;
  metadata?: Record<string, unknown>;
  prismaTx?: any;
  actorContext?: any;
  [key: string]: unknown;
}

/**
 * Phase 1.16.5 — ActionResult
 * Structured result returned by an ActionHandler invocation.
 */
export interface ActionResult<TData = Record<string, unknown>> {
  success: boolean;
  data?: TData;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    stack?: string;
    category?: any;
    attemptCount?: number;
  };
  idempotencyKey?: string;
}

/**
 * Phase 1.16.5 — ActionHandler interface contract
 * Every allowlisted action dispatcher implements this contract.
 */
export interface ActionHandler<TParams = unknown, TData = Record<string, unknown>> {
  readonly actionType: AutomationActionType;
  validateParams(rawParams: unknown): TParams;
  computeIdempotencyKey(params: TParams, context: ActionExecutionContext): string;
  execute(context: ActionExecutionContext, params: TParams): Promise<ActionResult<TData>>;
}

/**
 * Phase 1.16.6 — ExecutionEngineOptions
 * Configuration options for execution pipeline run.
 */
export interface ExecutionEngineOptions {
  stepTimeoutMs?: number; // default 30000 (30s)
  maxExecutionDepth?: number; // default 3
  now?: Date;
  actorContext?: any;
  prismaTx?: any;
  retryConfig?: {
    maxRetries?: number;
    baseDelayMs?: number;
    multiplier?: number;
    maxDelayMs?: number;
    maxJitterMs?: number;
    delayFn?: (delayMs: number) => Promise<void>;
  };
}

/**
 * Phase 1.16.6 — StepExecutionResult
 * Execution state recorded for a single rule step.
 */
export interface StepExecutionResult {
  stepId?: string;
  stepOrder: number;
  actionType: AutomationActionType;
  status: AutomationExecutionStepStatus;
  inputJson?: unknown;
  outputJson?: unknown;
  errorJson?: unknown;
  durationMs?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

/**
 * Phase 1.16.6 — ExecutionPipelineResult
 * Complete outcome returned by the sequential execution engine.
 */
export interface ExecutionPipelineResult {
  executionId: string;
  workspaceId: string;
  ruleId: string | null;
  ruleName?: string | null;
  status: AutomationExecutionStatus;
  reasonCode?: string | null;
  correlationId: string;
  executionDepth: number;
  causalityChain: string[];
  stepCount: number;
  steps: StepExecutionResult[];
  startedAt?: Date | null;
  completedAt?: Date | null;
  durationMs?: number | null;
  errorJson?: unknown;
}

/**
 * Phase 1.16.6 — ChildExecutionMetadata
 * Calculated provenance parameters for cascading child execution triggers.
 */
export interface ChildExecutionMetadata {
  parentExecutionId: string;
  executionDepth: number;
  causalityChain: string[];
  correlationId: string;
}

/**
 * Phase 1.16.7 — EntityOffsetConfig
 * Configuration for relative entity-offset scheduling.
 */
export interface EntityOffsetConfig {
  entityType: "WorkOrder" | "Invoice" | "ScheduleAppointment" | string;
  entityId: string;
  dateField: string;
  offsetSeconds: number; // Positive (after) or negative (before)
  [key: string]: unknown;
}

/**
 * Phase 1.16.7 — RegisterScheduleJobInput
 * Payload for registering a scheduled trigger job.
 */
export interface RegisterScheduleJobInput {
  ruleId: string;
  scheduleKind: "SCHEDULED_CRON" | "SCHEDULED_INTERVAL" | "SCHEDULED_ENTITY_OFFSET" | string;
  cronExpression?: string | null;
  intervalSeconds?: number | null;
  entityOffsetJson?: EntityOffsetConfig | null;
  isActive?: boolean;
}

/**
 * Phase 1.16.7 — SchedulePollingOptions
 * Options for schedule poller worker execution.
 */
export interface SchedulePollingOptions {
  maxJobsPerPoll?: number;
  maxFailureThreshold?: number; // default 5 for circuit breaker
  now?: Date;
  actorContext?: any;
  prismaTx?: any;
}

/**
 * Phase 1.16.7 — SchedulePollingSummary
 * Comprehensive summary of polling worker results.
 */
export interface SchedulePollingSummary {
  polledAt: Date;
  jobsChecked: number;
  jobsDispatched: number;
  jobsSkippedDueToConcurrency: number;
  jobsFailed: number;
  jobsDeactivatedByCircuitBreaker: number;
  results: Array<{
    jobId: string;
    ruleId: string;
    scheduleKind: string;
    status: "DISPATCHED" | "SKIPPED_CONCURRENCY" | "FAILED" | "DEACTIVATED";
    executionId?: string;
    nextRunAt?: Date | null;
    failureCount: number;
    error?: string;
  }>;
}

/**
 * Phase 1.16.8 — Automation Management Types & Schemas
 */


export interface CreateTriggerInput {
  triggerType: AutomationTriggerType | string;
  eventType: string;
  configJson?: Record<string, unknown> | null;
  filterJson?: Record<string, unknown> | null;
}


export interface CreateConditionInput {
  fieldPath: string;
  operator: ConditionOperator | string;
  targetValueJson: unknown;
  valueType?: string | null;
}

export interface CreateConditionGroupInput {
  logicalOperator: "AND" | "OR" | string;
  conditions?: CreateConditionInput[];
  childGroups?: CreateConditionGroupInput[];
}

export interface CreateActionInput {
  stepOrder: number;
  actionType: AutomationActionType | string;
  paramsJson: Record<string, unknown>;
}

export interface CreateAutomationRuleInput {
  name: string;
  description?: string | null;
  isEnabled?: boolean;
  errorPolicy?: AutomationErrorPolicy | string;
  trigger?: CreateTriggerInput | null;
  conditionGroup?: CreateConditionGroupInput | null;
  actions?: CreateActionInput[];
}

export interface UpdateAutomationRuleInput {
  name?: string;
  description?: string | null;
  isEnabled?: boolean;
  errorPolicy?: AutomationErrorPolicy | string;
  trigger?: CreateTriggerInput | null;
  conditionGroup?: CreateConditionGroupInput | null;
  actions?: CreateActionInput[];
}

export interface ListAutomationRulesQuery {
  isEnabled?: boolean;
  triggerType?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "name" | "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
}

export interface ListAutomationExecutionsQuery {
  ruleId?: string;
  status?: AutomationExecutionStatus | string;
  fromDate?: Date | string;
  toDate?: Date | string;
  page?: number;
  pageSize?: number;
  sortBy?: "createdAt" | "startedAt" | "completedAt";
  sortOrder?: "asc" | "desc";
}

export interface ListScheduleJobsQuery {
  ruleId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface TestRunAutomationRuleInput {
  eventType?: string;
  sourceEntity?: string;
  sourceId?: string;
  payload?: Record<string, unknown>;
}

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface WorkspaceAuthorizationContext {
  workspaceId: string;
  userId?: string;
  role?: MembershipRole;
}

