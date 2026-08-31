/**
 * Phase 1.18.12 — Idempotency & Safe Mutation Architecture Types
 * Aligned with Phase 1.18.1 Architecture Specification Section 12.
 */

export const IDEMPOTENCY_HEADER_NAME = "idempotency-key";
export const IDEMPOTENT_REPLAY_HEADER_NAME = "idempotent-replay";

/**
 * 24 hours in milliseconds (86,400,000 ms)
 * Locked in Phase 1.18.1 §12.3 retention window.
 */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export type IdempotencyStatus = "PENDING" | "RESOLVED" | "FAILED";

export interface IdempotencyScope {
    workspaceId: string;
    apiKeyId: string;
    endpoint: string;
    idempotencyKey: string;
}

export type IdempotencyAcquisitionResult =
    | {
          kind: "ACQUIRED";
          recordId: string;
          scopedKeyHash: string;
      }
    | {
          kind: "REPLAY";
          responseStatus: number;
          responseBody: any;
          responseHeaders?: Record<string, string>;
      }
    | {
          kind: "CONFLICT";
          message: string;
      }
    | {
          kind: "IN_PROGRESS";
          message: string;
      };

export interface WithIdempotencyOptions {
    /**
     * Explicit endpoint signature override (defaults to `${request.method} ${pathname}`).
     */
    endpoint?: string;

    /**
     * Retention window in milliseconds (defaults to 24 hours).
     */
    ttlMs?: number;

    /**
     * Whether Idempotency-Key header is strictly required on this endpoint (defaults to false / optional).
     */
    required?: boolean;
}
