/**
 * Phase 1.17.5 — Outbound Integration Engine Types & Options
 * Defines options, contexts, and parameter types for capability resolution
 * and execution management per Phase 1.17.1 §6.
 */

import type {
  IntegrationCapability,
  IntegrationConnection,
  IntegrationExecution,
} from "@/generated/prisma/client";
import type { DbClient } from "../adapters/adapterResolution";

export type { DbClient };

/**
 * Options for capability connection resolution.
 */
export interface ResolveCapabilityOptions {
  /**
   * Optional provider hint to select a specific provider instance (e.g. "resend", "sendgrid").
   */
  readonly providerHint?: string;

  /**
   * Database client or transaction client.
   */
  readonly dbClient?: DbClient;
}

/**
 * Options for capability execution management.
 */
export interface ExecuteCapabilityOptions {
  /**
   * Optional provider hint to target a specific provider.
   */
  readonly providerHint?: string;

  /**
   * Timeout in milliseconds. Defaults to CAPABILITY_REGISTRY[capability].defaultTimeoutMs.
   */
  readonly timeoutMs?: number;

  /**
   * Optional correlation ID. If not provided, a random UUIDv4 will be generated.
   */
  readonly correlationId?: string;

  /**
   * Optional manual idempotency key override. If not provided, a deterministic UUIDv5 is generated.
   */
  readonly idempotencyKeyOverride?: string;

  /**
   * Attempt number for this execution (defaults to 1).
   */
  readonly attemptNumber?: number;

  /**
   * Database client or transaction client.
   */
  readonly dbClient?: DbClient;
}

/**
 * Result bundle returned by execution manager with both the adapter execution result
 * and the persisted audit ledger record.
 */
export interface ExecutionManagerResult {
  readonly result: import("../adapters/types").IntegrationExecutionResult;
  readonly executionRecord: IntegrationExecution;
  readonly connection: IntegrationConnection;
}

/**
 * Options for capability execution management with reliability, retry, and backoff.
 */
export interface ExecuteCapabilityWithRetryOptions extends ExecuteCapabilityOptions {
  /**
   * Maximum number of attempts including the initial attempt. Defaults to 3 (Phase 1.17.1 §6.3).
   */
  readonly maxAttempts?: number;

  /**
   * Base delay in milliseconds for exponential backoff. Defaults to 500ms.
   */
  readonly baseDelayMs?: number;

  /**
   * Maximum delay ceiling in milliseconds. Defaults to 30,000ms (30s).
   */
  readonly maxDelayMs?: number;

  /**
   * Whether to add randomization jitter to backoff delay. Defaults to true.
   */
  readonly jitter?: boolean;

  /**
   * Optional custom sleep function for unit/integration testing with mock timers.
   */
  readonly sleepFn?: (ms: number) => Promise<void>;
}
