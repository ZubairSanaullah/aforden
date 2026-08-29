/**
 * Phase 1.17.5 — Outbound Integration Engine: Credential & Sensitive Data Redaction Engine
 * Implements recursive audit ledger scrubbing per Phase 1.17.1 §4.3.
 */

const SENSITIVE_KEY_REGEX =
  /^(api[_-]?key|secret|password|token|access[_-]?token|refresh[_-]?token|auth|authorization|bearer|private[_-]?key|client[_-]?secret|signing[_-]?secret|signature|cvv|cvc|credit[_-]?card|ssn)$/i;

const SENSITIVE_VALUE_REGEX =
  /^(Bearer\s+[A-Za-z0-9._~+/-]+=*|re_[a-zA-Z0-9_]{16,}|sk_[a-zA-Z0-9_]{16,}|whsec_[a-zA-Z0-9_]{16,})$/i;

/**
 * Recursively redacts sensitive keys and secret values from payload and response objects
 * prior to persisting snapshots to IntegrationExecution audit tables.
 */
export function redactSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === "string") {
    if (SENSITIVE_VALUE_REGEX.test(input)) {
      return "[REDACTED]" as unknown as T;
    }
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  if (typeof input === "object") {
    const output: Record<string, unknown> = {};
    const record = input as Record<string, unknown>;

    for (const [key, value] of Object.entries(record)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactSensitiveData(value);
      }
    }
    return output as unknown as T;
  }

  return input;
}
