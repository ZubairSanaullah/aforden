/**
 * Phase 1.17.6 — Outbound Integration Reliability & Retry Orchestrator
 * Implements retry, backoff, correlation propagation, rate-limit backoff, and connection error-state transitions
 * per Phase 1.17.1 §6.3 and §3.3.
 */

import crypto from "crypto";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationFailureCode,
} from "@/generated/prisma/client";
import { assertValidConnectionTransition } from "../connectionStateMachine";
import { executeCapability } from "./executionManager";
import { resolveCapabilityConnection } from "./capabilityResolver";
import type {
  ExecuteCapabilityWithRetryOptions,
  DbClient,
} from "./types";
import type { IntegrationExecutionResult } from "../adapters/types";

/**
 * Computes backoff delay in milliseconds for a retry attempt.
 * If provider supplied retryAfterSeconds, it takes precedence.
 * Otherwise, calculates exponential backoff: min(maxDelayMs, 2^attempt * baseDelayMs + jitter).
 */
export function computeBackoffDelayMs(
  attempt: number,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitter?: boolean;
    retryAfterSeconds?: number | null;
  }
): number {
  if (
    typeof options.retryAfterSeconds === "number" &&
    options.retryAfterSeconds > 0
  ) {
    return options.retryAfterSeconds * 1000;
  }

  const baseDelay = options.baseDelayMs ?? 500;
  const maxDelay = options.maxDelayMs ?? 30000;
  const expDelay = Math.pow(2, attempt) * baseDelay;

  let totalDelay = expDelay;
  if (options.jitter !== false) {
    // Add jitter: random value between 0 and min(100, expDelay * 0.1)
    const maxJitter = Math.min(100, expDelay * 0.1);
    const jitterAmount = Math.random() * maxJitter;
    totalDelay += jitterAmount;
  }

  return Math.min(maxDelay, Math.floor(totalDelay));
}

/**
 * Executes a capability action against an integration with automatic retry, exponential backoff,
 * correlation propagation, and error state transitions.
 *
 * Responsibility split (Phase 1.17.1 §6.3 & §3.3):
 * 1. Single source of truth for retryability: `result.failure.isRetryable` from the adapter execution.
 * 2. Max attempts: Defaults to 3 (or configured via options.maxAttempts).
 * 3. Rate-limit backoff: Honors `retryAfterSeconds` over computed exponential backoff.
 * 4. Audit ledger: Each attempt produces its own `IntegrationExecution` record with incremented attemptNumber,
 *    sharing the same logical `correlationId` and deterministic `idempotencyKey`.
 * 5. Connection error transition: When `AUTHENTICATION_FAILED` occurs (401/403), validates and transitions
 *    the connection status to `ERROR`. Transient retry exhaustion leaves connection as `CONNECTED`.
 */
export async function executeCapabilityWithRetry(
  workspaceId: string,
  capability: IntegrationCapability,
  action: string,
  payload: Record<string, unknown>,
  options?: ExecuteCapabilityWithRetryOptions
): Promise<IntegrationExecutionResult> {
  const db: DbClient = options?.dbClient ?? defaultPrisma;
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelayMs = options?.baseDelayMs ?? 500;
  const maxDelayMs = options?.maxDelayMs ?? 30000;
  const jitter = options?.jitter ?? true;
  const sleepFn =
    options?.sleepFn ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // Correlation ID: per-logical-operation (propagated across all retry attempts)
  const correlationId = options?.correlationId ?? crypto.randomUUID();

  let lastResult: IntegrationExecutionResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const executionResult = await executeCapability(
      workspaceId,
      capability,
      action,
      payload,
      {
        providerHint: options?.providerHint,
        timeoutMs: options?.timeoutMs,
        correlationId,
        idempotencyKeyOverride: options?.idempotencyKeyOverride,
        attemptNumber: attempt,
        dbClient: db,
      }
    );

    lastResult = executionResult;

    // 1. If success, return immediately
    if (executionResult.success) {
      return executionResult;
    }

    const failure = executionResult.failure;
    const isRetryable = failure?.isRetryable === true;
    const isAuthFailure =
      failure?.code === IntegrationFailureCode.AUTHENTICATION_FAILED;

    // 2. Handle persistent Authentication Failure -> Connection ERROR transition (Phase 1.17.1 §3.3)
    if (isAuthFailure) {
      await handleAuthenticationFailureTransition(
        workspaceId,
        capability,
        options?.providerHint,
        failure?.httpStatusCode,
        db
      );
      // Auth failures are non-retryable; terminate immediately
      return executionResult;
    }

    // 3. If retryable and attempts remain, calculate backoff and wait
    if (isRetryable && attempt < maxAttempts) {
      const delayMs = computeBackoffDelayMs(attempt, {
        baseDelayMs,
        maxDelayMs,
        jitter,
        retryAfterSeconds: failure?.retryAfterSeconds,
      });

      await sleepFn(delayMs);
      continue;
    }

    // 4. If non-retryable or attempts exhausted, terminate
    break;
  }

  return (
    lastResult ?? {
      success: false,
      capability,
      action,
      durationMs: 0,
      failure: {
        code: IntegrationFailureCode.INTERNAL_ADAPTER_ERROR,
        message: "Execution terminated without producing a result.",
        isRetryable: false,
      },
    }
  );
}

/**
 * Transitions the resolved connection to ERROR status upon persistent authentication failure (401/403).
 */
async function handleAuthenticationFailureTransition(
  workspaceId: string,
  capability: IntegrationCapability,
  providerHint: string | undefined,
  httpStatusCode: number | undefined,
  db: DbClient
): Promise<void> {
  try {
    const connection = await resolveCapabilityConnection(workspaceId, capability, {
      providerHint,
      dbClient: db,
    });

    if (connection.status === IntegrationConnectionStatus.CONNECTED) {
      const trigger =
        httpStatusCode === 403
          ? "EXECUTION:auth_failed_403"
          : "EXECUTION:auth_failed_401";

      assertValidConnectionTransition(
        connection.status,
        IntegrationConnectionStatus.ERROR,
        trigger
      );

      await db.integrationConnection.update({
        where: { id: connection.id },
        data: {
          status: IntegrationConnectionStatus.ERROR,
        },
      });
    }
  } catch {
    // If connection resolution fails or already in ERROR, ignore silently
  }
}
