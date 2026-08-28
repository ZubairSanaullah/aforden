/**
 * Phase 1.16.9 — Error Classification Engine (Invariant 6 & Invariant 7)
 *
 * Implements strict error taxonomy to classify execution errors into:
 * - TRANSIENT: Retryable infrastructure or network glitches.
 * - PERMANENT: Fatal business logic / validation errors (never retry).
 * - FATAL: Recursive cycles or depth limit violations (never retry).
 */

export enum AutomationErrorCategory {
  TRANSIENT = "TRANSIENT",
  PERMANENT = "PERMANENT",
  FATAL = "FATAL",
}

export interface ClassifiedError {
  category: AutomationErrorCategory;
  isRetryable: boolean;
  code: string;
  message: string;
  statusCode?: number;
  originalError?: unknown;
}

/**
 * Allowlisted transient error codes and substrings.
 */
const TRANSIENT_ERROR_CODES = new Set([
  "TRANSIENT_FAILURE",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
  "RATE_LIMITED",
  "LOCK_TIMEOUT",
  "DEADLOCK_DETECTED",
  "DATABASE_TIMEOUT",
  "NETWORK_ERROR",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "P1001", // Prisma: Can't reach database server
  "P1002", // Prisma: Database server was reached but timed out
  "P1008", // Prisma: Operations timed out
  "P2028", // Prisma: Transaction API error / timeout
  "P2034", // Prisma: Transaction failed due to write conflict or deadlock
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /deadlock/i,
  /connection lost/i,
  /connection refused/i,
  /connection reset/i,
  /network error/i,
  /rate limit/i,
  /too many requests/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /gateway timeout/i,
  /lock contention/i,
  /lock conflict/i,
  /econnreset/i,
  /etimedout/i,
];

/**
 * Known permanent error codes (fatal, non-retryable).
 */
const PERMANENT_ERROR_CODES = new Set([
  "EXECUTION_TIMEOUT",
  "AUTOMATION_EXECUTION_TIMEOUT",
  "VALIDATION_ERROR",
  "ACTION_PARAM_VALIDATION_ERROR",
  "INVALID_ACTION_TYPE",
  "AUTOMATION_RULE_NOT_FOUND",
  "AUTOMATION_EXECUTION_NOT_FOUND",
  "CONDITION_GROUP_NOT_FOUND",
  "NOT_FOUND",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "PLAN_FEATURE_NOT_ENABLED",
  "QUOTA_EXCEEDED",
  "INVALID_STATUS_TRANSITION",
  "CUSTOMER_NOT_FOUND",
  "WORK_ORDER_NOT_FOUND",
  "INVOICE_NOT_FOUND",
  "ASSET_NOT_FOUND",
  "PART_NOT_FOUND",
  "P2002", // Prisma: Unique constraint violation
  "P2003", // Prisma: Foreign key constraint violation
  "P2025", // Prisma: Record not found
]);

const FATAL_CYCLE_CODES = new Set([
  "MAX_EXECUTION_DEPTH_EXCEEDED",
  "RECURSIVE_CYCLE_DETECTED",
  "RECURSIVE_CASCADE_HALTED",
]);

/**
 * Classifies an error into TRANSIENT, PERMANENT, or FATAL.
 */
export function classifyAutomationError(error: unknown): ClassifiedError {
  if (!error) {
    return {
      category: AutomationErrorCategory.PERMANENT,
      isRetryable: false,
      code: "UNKNOWN_ERROR",
      message: "Unknown error occurred",
    };
  }

  const err = error as any;
  const code: string =
    err.code ||
    err.name ||
    err.errorCode ||
    (typeof err === "string" ? err : "INTERNAL_ERROR");
  const message: string =
    err.message ||
    (typeof err === "string" ? err : "An unexpected error occurred");
  const statusCode: number | undefined = err.statusCode || err.status;

  // 1. Check FATAL cycle / recursion prevention codes
  if (FATAL_CYCLE_CODES.has(code) || code.includes("RECURSIVE") || code.includes("MAX_EXECUTION_DEPTH")) {
    return {
      category: AutomationErrorCategory.FATAL,
      isRetryable: false,
      code,
      message,
      statusCode: 422,
      originalError: error,
    };
  }

  // 2. Check explicitly permanent HTTP status codes (4xx except 408 / 429)
  if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) {
    return {
      category: AutomationErrorCategory.PERMANENT,
      isRetryable: false,
      code,
      message,
      statusCode,
      originalError: error,
    };
  }

  // 3. Check explicitly permanent error codes
  if (PERMANENT_ERROR_CODES.has(code)) {
    return {
      category: AutomationErrorCategory.PERMANENT,
      isRetryable: false,
      code,
      message,
      statusCode: statusCode ?? 400,
      originalError: error,
    };
  }

  // 4. Check explicitly transient error codes
  if (TRANSIENT_ERROR_CODES.has(code)) {
    return {
      category: AutomationErrorCategory.TRANSIENT,
      isRetryable: true,
      code,
      message,
      statusCode: statusCode ?? 503,
      originalError: error,
    };
  }

  // 5. Check transient HTTP status codes (408, 429, 502, 503, 504)
  if (statusCode && [408, 429, 502, 503, 504].includes(statusCode)) {
    return {
      category: AutomationErrorCategory.TRANSIENT,
      isRetryable: true,
      code: code || "HTTP_TRANSIENT_ERROR",
      message,
      statusCode,
      originalError: error,
    };
  }

  // 6. Check message regex patterns
  for (const pattern of TRANSIENT_MESSAGE_PATTERNS) {
    if (pattern.test(message) || pattern.test(code)) {
      return {
        category: AutomationErrorCategory.TRANSIENT,
        isRetryable: true,
        code: code || "TRANSIENT_ERROR",
        message,
        statusCode: statusCode ?? 503,
        originalError: error,
      };
    }
  }

  // 7. Default unclassified server errors: classify as TRANSIENT if 500-level, else PERMANENT
  if (statusCode && statusCode >= 500) {
    return {
      category: AutomationErrorCategory.TRANSIENT,
      isRetryable: true,
      code,
      message,
      statusCode,
      originalError: error,
    };
  }

  return {
    category: AutomationErrorCategory.PERMANENT,
    isRetryable: false,
    code,
    message,
    statusCode: statusCode ?? 500,
    originalError: error,
  };
}

/**
 * Returns true if the error is classified as transient (retryable).
 */
export function isTransientError(error: unknown): boolean {
  return classifyAutomationError(error).isRetryable;
}
