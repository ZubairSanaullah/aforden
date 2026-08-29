/**
 * Phase 1.17.3 — Mock In-Memory Email Adapter
 * Non-network reference adapter proving end-to-end implementability of the IntegrationAdapter contract.
 * Implements EMAIL_SEND with realistic validation, connection lifecycle simulation,
 * normalized failure responses per §6.3 taxonomy, and webhook normalization.
 */

import crypto from "crypto";
import {
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationFailureCode,
  type IntegrationAdapter,
  type IntegrationConnection,
  type IntegrationSecretReference,
  type ConnectResult,
  type TestResult,
  type IntegrationExecutionRequest,
  type IntegrationExecutionResult,
  type IntegrationEvent,
} from "./types";

export class MockEmailAdapter implements IntegrationAdapter {
  public readonly integrationId: string;
  public readonly displayName: string;
  public readonly version: string = "1.0.0";

  constructor(integrationId: string = "mock_email", displayName: string = "Mock Email Adapter") {
    this.integrationId = integrationId;
    this.displayName = displayName;
  }

  public getCapabilities(): readonly IntegrationCapability[] {
    return [IntegrationCapability.EMAIL_SEND];
  }

  public async connect(
    connection: IntegrationConnection,
    _authPayload?: unknown
  ): Promise<ConnectResult> {
    const isSimulateFailure = Boolean(
      (connection.configJson as Record<string, unknown>)?.simulateConnectFailure
    );

    if (isSimulateFailure) {
      return {
        success: false,
        connectionStatus: IntegrationConnectionStatus.ERROR,
        credentialReference: {
          secretId: "sec_mock_failed",
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: "sha256:invalid",
        },
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "Mock connection handshake rejected by upstream simulator",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    return {
      success: true,
      connectionStatus: IntegrationConnectionStatus.CONNECTED,
      externalAccountId: "mock_email_acc_001",
      externalAccountName: "Mock Transactional Email Provider",
      credentialReference: {
        secretId: `sec_mock_${connection.id.slice(0, 8)}`,
        version: 1,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        fingerprint: `sha256:mock_${crypto.createHash("sha256").update(connection.id).digest("hex").slice(0, 16)}`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
      metadata: {
        provider: "MockEmailService",
        region: "us-east-1",
        defaultSender: "no-reply@aforden.test",
      },
    };
  }

  public async disconnect(
    _connection: IntegrationConnection,
    _secretReference: IntegrationSecretReference
  ): Promise<void> {
    // Stateless cleanup simulation
    return Promise.resolve();
  }

  public async testConnection(
    connection: IntegrationConnection,
    secretReference: IntegrationSecretReference
  ): Promise<TestResult> {
    const config = (connection.configJson as Record<string, unknown>) || {};
    const isSimulateFailure =
      Boolean(config.simulateFailure) ||
      secretReference.fingerprint === "invalid" ||
      secretReference.fingerprint?.includes("invalid");

    if (isSimulateFailure) {
      return {
        success: false,
        latencyMs: 35,
        checkedAt: new Date(),
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "Mock API key verification failed: invalid credentials",
          isRetryable: false,
          httpStatusCode: 401,
          diagnostics: {
            fingerprint: secretReference.fingerprint,
          },
        },
      };
    }

    return {
      success: true,
      latencyMs: 25,
      checkedAt: new Date(),
      details: {
        ping: "pong",
        status: "healthy",
        provider: "mock_email",
      },
    };
  }

  public async execute(
    request: IntegrationExecutionRequest
  ): Promise<IntegrationExecutionResult> {
    const start = Date.now();

    // 1. Validate capability match
    if (request.capability !== IntegrationCapability.EMAIL_SEND) {
      return {
        success: false,
        capability: request.capability,
        action: request.action,
        durationMs: Date.now() - start,
        failure: {
          code: IntegrationFailureCode.CAPABILITY_UNSUPPORTED,
          message: `Capability '${request.capability}' is not supported by ${this.displayName}.`,
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const payload = request.payload || {};

    // Simulated delay for timeout testing
    if (typeof payload.simulateDelayMs === "number" && payload.simulateDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, payload.simulateDelayMs as number));
    }

    // 2. Simulated rate-limiting failure mode
    if (payload.simulateRateLimit === true) {
      const retryAfter = typeof payload.retryAfterSeconds === "number" ? payload.retryAfterSeconds : 30;
      return {
        success: false,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 429,
        failure: {
          code: IntegrationFailureCode.RATE_LIMITED,
          message: "Rate limit exceeded on mock email provider",
          isRetryable: true,
          retryAfterSeconds: retryAfter,
          httpStatusCode: 429,
        },
      };
    }

    // 3. Simulated service unavailable failure mode
    if (payload.simulateServiceUnavailable === true) {
      return {
        success: false,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 503,
        failure: {
          code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
          message: "Mock upstream service temporarily unavailable",
          isRetryable: true,
          httpStatusCode: 503,
        },
      };
    }

    // 4. Simulated auth failure mode (401/403)
    if (payload.simulateAuthFailure === true) {
      const statusCode = payload.authStatusCode === 403 ? 403 : 401;
      return {
        success: false,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: statusCode,
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: statusCode === 403 ? "Mock upstream forbidden (403)" : "Mock upstream unauthorized (401)",
          isRetryable: false,
          httpStatusCode: statusCode,
        },
      };
    }

    // 5. Simulated network timeout failure mode
    if (payload.simulateNetworkTimeout === true) {
      return {
        success: false,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 504,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: "Mock upstream network gateway timeout",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }

    // 4. Payload validation
    const to = payload.to;
    const subject = payload.subject;
    const body = payload.body || payload.html;

    const isValidEmail = (email: unknown): boolean =>
      typeof email === "string" && email.includes("@") && !email.startsWith("@") && !email.endsWith("@");

    const recipientsValid =
      typeof to === "string"
        ? isValidEmail(to)
        : Array.isArray(to) && to.length > 0 && to.every(isValidEmail);

    const isSubjectValid = typeof subject === "string" && subject.trim().length > 0;
    const isBodyValid = typeof body === "string" && body.trim().length > 0;

    if (!recipientsValid || !isSubjectValid || !isBodyValid || payload.simulateValidationFailure === true) {
      return {
        success: false,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: "Payload validation failed: valid 'to' email, non-empty 'subject', and 'body' are required.",
          isRetryable: false,
          httpStatusCode: 400,
          diagnostics: {
            hasValidRecipients: recipientsValid,
            hasValidSubject: isSubjectValid,
            hasValidBody: isBodyValid,
          },
        },
      };
    }

    // 5. Successful simulated dispatch
    const recipientCount = Array.isArray(to) ? to.length : 1;
    const messageId = `msg_mock_${crypto.randomUUID()}`;

    return {
      success: true,
      capability: IntegrationCapability.EMAIL_SEND,
      action: request.action,
      durationMs: Date.now() - start,
      rawResponseStatus: 200,
      providerRequestId: `req_mock_${crypto.randomUUID().slice(0, 8)}`,
      data: {
        messageId,
        to,
        subject,
        recipientCount,
        sentAt: new Date().toISOString(),
        idempotencyKey: request.idempotencyKey,
      },
    };
  }

  public async handleWebhook(
    payload: unknown,
    headers: Headers,
    _secretReference: IntegrationSecretReference,
    connection: IntegrationConnection
  ): Promise<IntegrationEvent | null> {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    // Simulate signature validation check
    const signature = headers.get("x-mock-signature");
    if (signature === "invalid") {
      return null;
    }

    const payloadObj = payload as Record<string, unknown>;

    // Allow simulating ignored or unhandled webhook event types
    if (payloadObj.simulateIgnored === true || payloadObj.eventType === "unhandled.event") {
      return null;
    }

    const rawPayloadHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    const eventId = typeof payloadObj.eventId === "string"
      ? payloadObj.eventId
      : `evt_mock_${crypto.randomUUID()}`;

    const eventType = typeof payloadObj.eventType === "string"
      ? payloadObj.eventType
      : "email.delivered";

    const entityId = typeof payloadObj.messageId === "string"
      ? payloadObj.messageId
      : typeof payloadObj.id === "string"
      ? payloadObj.id
      : `msg_${crypto.randomUUID().slice(0, 8)}`;

    const occurredAt = payloadObj.occurredAt
      ? new Date(payloadObj.occurredAt as string | number)
      : new Date();

    return {
      eventId,
      eventType,
      occurredAt,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      entityType: "EmailMessage",
      entityId,
      payload: payloadObj,
      rawPayloadHash,
    };
  }
}
