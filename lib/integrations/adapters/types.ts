import {
  IntegrationStatus,
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationFailureCode,
  type IntegrationConnection,
} from "@/generated/prisma/client";

export {
  IntegrationStatus,
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationFailureCode,
  type IntegrationConnection,
};

/**
 * Phase 1.17.1 §4.1 — IntegrationSecretReference
 * Safe reference to an envelope-encrypted credential vault entry.
 * Contains zero plaintext secret material; safe to pass across internal boundaries.
 */
export interface IntegrationSecretReference {
  readonly secretId: string;
  readonly version: number;
  readonly keyVaultProvider: "AWS_KMS" | "LOCAL_ENCRYPTED_DB" | "HASHICORP_VAULT" | string;
  readonly algorithm: "AES_256_GCM" | string;
  readonly fingerprint: string;
  readonly expiresAt?: Date | null;
  readonly secretPayload?: string | Record<string, unknown>;
}

/**
 * Phase 1.17.1 §6.3 — IntegrationFailure
 * Standardized error taxonomy normalizing all third-party faults, rate limits, and network errors.
 */
export interface IntegrationFailure {
  readonly code: IntegrationFailureCode;
  readonly message: string;
  readonly isRetryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly providerRawCode?: string;
  readonly providerRawMessage?: string;
  readonly httpStatusCode?: number;
  readonly diagnostics?: Record<string, unknown>;
}

/**
 * Phase 1.17.1 §2.1 — ConnectResult
 * Returned upon establishing or validating a connection handshake.
 */
export interface ConnectResult {
  readonly success: boolean;
  readonly connectionStatus: IntegrationConnectionStatus;
  readonly externalAccountId?: string;
  readonly externalAccountName?: string;
  readonly credentialReference: IntegrationSecretReference;
  readonly metadata?: Record<string, unknown>;
  readonly failure?: IntegrationFailure;
}

/**
 * Phase 1.17.1 §2.1 — TestResult
 * Non-destructive health check ping response.
 */
export interface TestResult {
  readonly success: boolean;
  readonly latencyMs: number;
  readonly checkedAt: Date;
  readonly failure?: IntegrationFailure;
  readonly details?: Record<string, unknown>;
}

/**
 * Phase 1.17.1 §2.1 — IntegrationExecutionRequest
 * Standardized payload passed to an adapter's execute() method.
 */
export interface IntegrationExecutionRequest {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly capability: IntegrationCapability;
  readonly action: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly timeoutMs?: number;
  readonly secretReference: IntegrationSecretReference;
  readonly connectionConfig: Record<string, unknown>;
}

/**
 * Phase 1.17.1 §2.1 — IntegrationExecutionResult
 * Normalized execution result returned from an adapter's execute() method.
 */
export interface IntegrationExecutionResult {
  readonly success: boolean;
  readonly capability: IntegrationCapability;
  readonly action: string;
  readonly data?: Record<string, unknown>;
  readonly rawResponseStatus?: number;
  readonly providerRequestId?: string;
  readonly durationMs: number;
  readonly failure?: IntegrationFailure;
}

/**
 * Phase 1.17.1 §2.1 — IntegrationEvent
 * Canonical normalized event schema produced by handleWebhook().
 */
export interface IntegrationEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly entityType: string;
  readonly entityId?: string;
  readonly payload: Record<string, unknown>;
  readonly rawPayloadHash: string;
}

/**
 * Phase 1.17.1 §2.1 — IntegrationAdapter
 * Universal stateless provider adapter contract.
 * Every concrete provider integration (Resend, Twilio, QuickBooks, etc.) implements this interface.
 */
export interface IntegrationAdapter {
  readonly integrationId: string;
  readonly displayName: string;
  readonly version: string;

  /**
   * Initializes or verifies a connection handshake (e.g. exchange OAuth code or verify API key).
   */
  connect(
    connection: IntegrationConnection,
    authPayload?: unknown
  ): Promise<ConnectResult>;

  /**
   * Gracefully tears down connection (e.g. revokes OAuth tokens upstream).
   */
  disconnect(
    connection: IntegrationConnection,
    secretReference: IntegrationSecretReference
  ): Promise<void>;

  /**
   * Non-destructive health check ping to verify credential validity and upstream API reachability.
   */
  testConnection(
    connection: IntegrationConnection,
    secretReference: IntegrationSecretReference
  ): Promise<TestResult>;

  /**
   * Executes a discrete outbound capability action.
   */
  execute(
    request: IntegrationExecutionRequest
  ): Promise<IntegrationExecutionResult>;

  /**
   * Ingests, verifies, and normalizes an inbound webhook payload.
   */
  handleWebhook(
    payload: unknown,
    headers: Headers,
    secretReference: IntegrationSecretReference,
    connection: IntegrationConnection
  ): Promise<IntegrationEvent | null>;

  /**
   * Returns the immutable list of capabilities advertised and implemented by this adapter.
   */
  getCapabilities(): readonly IntegrationCapability[];
}
