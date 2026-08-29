import type {
  IntegrationWebhook,
  IntegrationWebhookEvent,
  IntegrationCredential,
  IntegrationConnection,
} from "@/generated/prisma/client";
import type { DbClient } from "../adapters/adapterResolution";
import type { IntegrationEvent } from "../adapters/types";

export type { DbClient };

/**
 * Outcome categorization for inbound webhook processing.
 */
export type WebhookProcessingOutcome =
  | "SUCCESS"
  | "REPLAY_DISCARDED"
  | "IDEMPOTENT_IGNORED"
  | "IGNORED"
  | "FAILED";

/**
 * The 8 sequential stages of the inbound webhook processing pipeline locked in Phase 1.17.1 §5:
 * Stage 1: Cryptographic Signature Verification
 * Stage 2: Timestamp Validation Window
 * Stage 3: Replay Protection Nonce / Digest Check
 * Stage 4: Strict Tenant Resolution via Registered Endpoint Slug
 * Stage 5: Connection State & Entitlement Guard
 * Stage 6: Idempotency Check & Transactional Inbox Persist
 * Stage 7: Event Normalization (Adapter Delegation)
 * Stage 8: Domain Event Dispatch
 */
export type WebhookPipelineStage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Discriminated result returned by processInboundWebhook().
 * Designed for immediate mapping to Next.js API route responses in Phase 1.17.9.
 */
export interface WebhookProcessingResult {
  /**
   * High-level outcome category.
   */
  readonly outcome: WebhookProcessingOutcome;

  /**
   * The pipeline stage that resolved or short-circuited execution.
   */
  readonly stage: WebhookPipelineStage;

  /**
   * HTTP status code to return to the external webhook caller.
   */
  readonly httpStatus: number;

  /**
   * Optional HTTP response headers (e.g. Retry-After: 300 on HTTP 503).
   */
  readonly responseHeaders?: Record<string, string>;

  /**
   * Explanatory status or error description.
   */
  readonly message?: string;

  /**
   * Target endpoint slug resolved in Stage 4.
   */
  readonly endpointSlug: string;

  /**
   * Target workspace ID strictly resolved from DB record (Stage 4).
   */
  readonly workspaceId?: string;

  /**
   * Target connection ID strictly resolved from DB record (Stage 4).
   */
  readonly connectionId?: string;

  /**
   * Normalized domain event produced in Stage 7 and dispatched in Stage 8.
   */
  readonly event?: IntegrationEvent;

  /**
   * ID of the persisted IntegrationWebhookEvent inbox record (Stage 6).
   */
  readonly webhookEventRecordId?: string;

  /**
   * Optional diagnostic details for audit logging.
   */
  readonly diagnostics?: Record<string, unknown>;
}

/**
 * Configurable options passed to processInboundWebhook().
 */
export interface WebhookPipelineOptions {
  /**
   * Database client or transaction client. Defaults to standard prisma instance.
   */
  readonly dbClient?: DbClient;

  /**
   * Clock override for deterministic time verification in test suites.
   */
  readonly now?: Date;

  /**
   * Bypass signature verification (intended for mock tests and development environments).
   */
  readonly skipSignatureVerification?: boolean;

  /**
   * Bypass timestamp validation window.
   */
  readonly skipTimestampVerification?: boolean;

  /**
   * Custom secret resolver for unwrapping or decrypting credential secrets.
   */
  readonly customSecretResolver?: (credential: IntegrationCredential) => string | Promise<string>;
}
