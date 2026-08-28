/**
 * Phase 1.16.9 — Reliability & Retry Engine (Invariant 7)
 *
 * Implements exponential backoff with additive jitter and transient retry loop
 * for allowlisted automation action step executions.
 */

import { classifyAutomationError, AutomationErrorCategory } from "./errorClassifier";
import type { ActionExecutionContext, ActionResult } from "./automation.types";

export interface AutomationRetryConfig {
  maxRetries?: number; // Default: 3 (Invariant 7.4)
  baseDelayMs?: number; // Default: 1000ms
  multiplier?: number; // Default: 2
  maxDelayMs?: number; // Default: 30000ms (30s)
  maxJitterMs?: number; // Default: 500ms
  delayFn?: (delayMs: number) => Promise<void>; // Mockable delay function
}

export const DEFAULT_RETRY_CONFIG: Required<Omit<AutomationRetryConfig, "delayFn">> = {
  maxRetries: 3,
  baseDelayMs: process.env.NODE_ENV === "test" ? 10 : 1000,
  multiplier: 2,
  maxDelayMs: process.env.NODE_ENV === "test" ? 50 : 30000,
  maxJitterMs: process.env.NODE_ENV === "test" ? 5 : 500,
};

/**
 * Computes exponential backoff with additive uniform jitter per Invariant 7.4:
 * delayMs = min(maxDelayMs, baseDelayMs * (multiplier ** (attempt - 1))) + uniform(0, maxJitterMs)
 */
export function calculateAutomationBackoff(
  attempt: number,
  config: AutomationRetryConfig = {},
): number {
  const base = config.baseDelayMs ?? DEFAULT_RETRY_CONFIG.baseDelayMs;
  const mult = config.multiplier ?? DEFAULT_RETRY_CONFIG.multiplier;
  const max = config.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs;
  const maxJitter = config.maxJitterMs ?? DEFAULT_RETRY_CONFIG.maxJitterMs;

  const exponent = Math.max(0, attempt - 1);
  const rawDelay = base * Math.pow(mult, exponent);
  const cappedDelay = Math.min(rawDelay, max);
  const jitter = maxJitter > 0 ? Math.random() * maxJitter : 0;

  return Math.max(0, Math.round(cappedDelay + jitter));
}

export interface StepRetryExecutionResult {
  result: ActionResult;
  attemptCount: number;
  retriesExhausted: boolean;
  errorCategory?: AutomationErrorCategory;
  lastError?: unknown;
}

/**
 * Executes an action handler with automatic transient retry loop up to maxRetries.
 * Non-transient / permanent failures are rejected immediately with 0 retries.
 */
export async function executeStepWithRetry(
  executeFn: () => Promise<ActionResult>,
  context: ActionExecutionContext,
  config: AutomationRetryConfig = {},
): Promise<StepRetryExecutionResult> {
  const maxRetries = config.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries;
  const delayFn = config.delayFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastResult: ActionResult | null = null;
  let lastError: unknown = null;
  let lastCategory: AutomationErrorCategory = AutomationErrorCategory.PERMANENT;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await executeFn();
      if (result.success) {
        return {
          result,
          attemptCount: attempt,
          retriesExhausted: false,
        };
      }

      // Handler returned a failure ActionResult
      lastResult = result;
      const classification = classifyAutomationError(result.error);
      lastCategory = classification.category;
      lastError = result.error;

      if (!classification.isRetryable || attempt >= maxRetries) {
        return {
          result,
          attemptCount: attempt,
          retriesExhausted: classification.isRetryable && attempt >= maxRetries,
          errorCategory: classification.category,
          lastError: result.error,
        };
      }

      // Transient failure with retries remaining: backoff and retry
      const delayMs = calculateAutomationBackoff(attempt, config);
      if (delayMs > 0) {
        await delayFn(delayMs);
      }
    } catch (err: unknown) {
      const classification = classifyAutomationError(err);
      lastCategory = classification.category;
      lastError = err;

      if (!classification.isRetryable || attempt >= maxRetries) {
        const errorResult: ActionResult = {
          success: false,
          error: {
            code: classification.code,
            message: classification.message,
            category: classification.category,
            attemptCount: attempt,
          },
        };
        return {
          result: errorResult,
          attemptCount: attempt,
          retriesExhausted: classification.isRetryable && attempt >= maxRetries,
          errorCategory: classification.category,
          lastError: err,
        };
      }

      const delayMs = calculateAutomationBackoff(attempt, config);
      if (delayMs > 0) {
        await delayFn(delayMs);
      }
    }
  }

  const finalResult: ActionResult = lastResult ?? {
    success: false,
    error: {
      code: "RETRIES_EXHAUSTED",
      message: `Action execution exhausted all ${maxRetries} retry attempts`,
      category: lastCategory,
      attemptCount: maxRetries,
    },
  };

  return {
    result: finalResult,
    attemptCount: maxRetries,
    retriesExhausted: true,
    errorCategory: lastCategory,
    lastError,
  };
}
