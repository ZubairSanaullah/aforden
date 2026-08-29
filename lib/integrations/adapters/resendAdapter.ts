/**
 * Phase 1.17.7 — Resend Provider Adapter
 * Real, network-facing provider adapter implementing IntegrationAdapter for EMAIL_SEND.
 * Uses Resend REST API, Svix webhook signature verification, and exhaustive error translations.
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
  type IntegrationFailure,
} from "./types";

export interface ResendEmailPayload {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  body?: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export class ResendAdapter implements IntegrationAdapter {
  public readonly integrationId = "resend";
  public readonly displayName = "Resend";
  public readonly version = "1.0.0";

  public getCapabilities(): readonly IntegrationCapability[] {
    return [IntegrationCapability.EMAIL_SEND];
  }

  /**
   * Validates API credentials by querying the Resend API.
   */
  public async connect(
    connection: IntegrationConnection,
    authPayload?: unknown
  ): Promise<ConnectResult> {
    const apiKey = this.extractApiKey(authPayload, connection);

    if (!apiKey) {
      return {
        success: false,
        connectionStatus: IntegrationConnectionStatus.ERROR,
        credentialReference: {
          secretId: "missing",
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: "sha256:missing",
        },
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "Resend API key is missing from authPayload or connection config.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    const start = Date.now();
    try {
      const response = await fetch("https://api.resend.com/api-keys", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "Aforden-Integration-Engine/1.0",
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const failure = this.translateResendError(response.status, errorBody);
        return {
          success: false,
          connectionStatus: IntegrationConnectionStatus.ERROR,
          credentialReference: {
            secretId: `sec_resend_${connection.id.slice(0, 8)}`,
            version: 1,
            keyVaultProvider: "LOCAL_ENCRYPTED_DB",
            algorithm: "AES_256_GCM",
            fingerprint: `sha256:${crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`,
          },
          failure,
        };
      }

      return {
        success: true,
        connectionStatus: IntegrationConnectionStatus.CONNECTED,
        externalAccountId: `resend_${crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}`,
        externalAccountName: "Resend Email Service",
        credentialReference: {
          secretId: `sec_resend_${connection.id.slice(0, 8)}`,
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: `sha256:${crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`,
        },
        metadata: {
          connectedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        connectionStatus: IntegrationConnectionStatus.ERROR,
        credentialReference: {
          secretId: "error",
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: "sha256:error",
        },
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: err instanceof Error ? err.message : "Failed to connect to Resend API.",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
  }

  public async disconnect(
    _connection: IntegrationConnection,
    _secretReference: IntegrationSecretReference
  ): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Performs a lightweight health check ping against Resend API.
   */
  public async testConnection(
    connection: IntegrationConnection,
    secretReference: IntegrationSecretReference
  ): Promise<TestResult> {
    const apiKey = this.extractApiKeyFromSecret(secretReference, connection);
    const start = Date.now();

    if (!apiKey) {
      return {
        success: false,
        latencyMs: 0,
        checkedAt: new Date(),
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "No decrypted API key found in secret reference.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    try {
      const response = await fetch("https://api.resend.com/api-keys", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "Aforden-Integration-Engine/1.0",
        },
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const failure = this.translateResendError(response.status, errorBody);
        return {
          success: false,
          latencyMs,
          checkedAt: new Date(),
          failure,
        };
      }

      return {
        success: true,
        latencyMs,
        checkedAt: new Date(),
        details: {
          statusCode: response.status,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
        failure: {
          code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
          message: err instanceof Error ? err.message : "Resend health check failed.",
          isRetryable: true,
          httpStatusCode: 503,
        },
      };
    }
  }

  /**
   * Dispatches transactional email via Resend API.
   */
  public async execute(
    request: IntegrationExecutionRequest
  ): Promise<IntegrationExecutionResult> {
    const start = Date.now();

    if (request.capability !== IntegrationCapability.EMAIL_SEND) {
      return {
        success: false,
        capability: request.capability,
        action: request.action,
        durationMs: Date.now() - start,
        failure: {
          code: IntegrationFailureCode.CAPABILITY_UNSUPPORTED,
          message: `Capability '${request.capability}' is not supported by ResendAdapter.`,
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const payload = (request.payload || {}) as unknown as ResendEmailPayload;

    // Validate payload
    const validationError = this.validateEmailPayload(payload);
    if (validationError) {
      return {
        success: false,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: validationError,
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const apiKey = this.extractApiKeyFromSecret(
      request.secretReference,
      { configJson: request.connectionConfig } as unknown as IntegrationConnection
    );

    if (!apiKey) {
      return {
        success: false,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 401,
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "No decrypted API key found for Resend connection.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    const fromAddress =
      payload.from ||
      (request.connectionConfig?.fromEmail as string) ||
      "Aforden <notifications@aforden.com>";

    const htmlContent = payload.html || payload.body;
    const textContent = payload.text || (!payload.html ? payload.body : undefined);

    const bodyData: Record<string, unknown> = {
      from: fromAddress,
      to: Array.isArray(payload.to) ? payload.to : [payload.to],
      subject: payload.subject,
      ...(htmlContent ? { html: htmlContent } : {}),
      ...(textContent ? { text: textContent } : {}),
      ...(payload.cc ? { cc: Array.isArray(payload.cc) ? payload.cc : [payload.cc] } : {}),
      ...(payload.bcc ? { bcc: Array.isArray(payload.bcc) ? payload.bcc : [payload.bcc] } : {}),
      ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
      ...(payload.headers ? { headers: payload.headers } : {}),
      ...(payload.tags ? { tags: payload.tags } : {}),
    };

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": request.idempotencyKey,
          "User-Agent": "Aforden-Integration-Engine/1.0",
        },
        body: JSON.stringify(bodyData),
      });

      const durationMs = Date.now() - start;
      const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const retryAfterHeader = response.headers?.get ? response.headers.get("retry-after") : undefined;
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

        const failure = this.translateResendError(
          response.status,
          responseJson,
          !isNaN(retryAfterSeconds as number) ? retryAfterSeconds : undefined
        );

        return {
          success: false,
          capability: IntegrationCapability.EMAIL_SEND,
          action: request.action,
          durationMs,
          rawResponseStatus: response.status,
          failure,
        };
      }

      return {
        success: true,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs,
        rawResponseStatus: response.status,
        providerRequestId: typeof responseJson.id === "string" ? responseJson.id : undefined,
        data: {
          messageId: responseJson.id,
          to: payload.to,
          from: fromAddress,
          subject: payload.subject,
          idempotencyKey: request.idempotencyKey,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 504,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: err instanceof Error ? err.message : "Network error contacting Resend API.",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
  }

  /**
   * Normalizes incoming Resend (Svix) webhooks to IntegrationEvent.
   */
  public async handleWebhook(
    payload: unknown,
    headers: Headers,
    secretReference: IntegrationSecretReference,
    connection: IntegrationConnection
  ): Promise<IntegrationEvent | null> {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const signingSecret =
      (secretReference?.secretPayload as string) ||
      ((connection.configJson as Record<string, unknown>)?.webhookSigningSecret as string);

    if (signingSecret) {
      const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
      const isValid = verifySvixSignature(rawBody, headers, signingSecret);
      if (!isValid) {
        return null;
      }
    }

    const payloadObj = payload as Record<string, unknown>;
    const eventType = typeof payloadObj.type === "string" ? payloadObj.type : "email.unknown";
    const data = (payloadObj.data as Record<string, unknown>) || {};
    const emailId = (data.email_id || data.id || payloadObj.id || crypto.randomUUID()) as string;

    const rawPayloadHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    return {
      eventId: `evt_resend_${emailId}`,
      eventType,
      occurredAt: payloadObj.created_at ? new Date(payloadObj.created_at as string) : new Date(),
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      entityType: "EmailMessage",
      entityId: emailId,
      payload: {
        emailId,
        to: data.to,
        from: data.from,
        subject: data.subject,
        status: eventType.replace("email.", ""),
        rawEvent: payloadObj,
      },
      rawPayloadHash,
    };
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private extractApiKey(authPayload: unknown, connection: IntegrationConnection): string | null {
    if (typeof authPayload === "string" && authPayload.trim().length > 0) {
      return authPayload.trim();
    }
    if (authPayload && typeof authPayload === "object") {
      const obj = authPayload as Record<string, unknown>;
      if (typeof obj.apiKey === "string" && obj.apiKey.trim().length > 0) {
        return obj.apiKey.trim();
      }
    }
    const config = connection.configJson as Record<string, unknown> | null;
    if (config && typeof config.apiKey === "string" && config.apiKey.trim().length > 0) {
      return config.apiKey.trim();
    }
    return process.env.RESEND_API_KEY || null;
  }

  private extractApiKeyFromSecret(
    secretReference: IntegrationSecretReference | undefined,
    connection: IntegrationConnection
  ): string | null {
    if (typeof secretReference?.secretPayload === "string" && secretReference.secretPayload.trim().length > 0) {
      return secretReference.secretPayload.trim();
    }
    if (secretReference?.secretPayload && typeof secretReference.secretPayload === "object") {
      const obj = secretReference.secretPayload as Record<string, unknown>;
      if (typeof obj.apiKey === "string" && obj.apiKey.trim().length > 0) {
        return obj.apiKey.trim();
      }
    }
    const config = connection.configJson as Record<string, unknown> | null;
    if (config && typeof config.apiKey === "string" && config.apiKey.trim().length > 0) {
      return config.apiKey.trim();
    }
    return process.env.RESEND_API_KEY || null;
  }

  private validateEmailPayload(payload: ResendEmailPayload): string | null {
    if (!payload.to) return "Field 'to' is required.";
    const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
    if (recipients.length === 0) return "At least one recipient in 'to' is required.";

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of recipients) {
      if (typeof email !== "string" || !emailRegex.test(email)) {
        return `Invalid recipient email format: '${email}'`;
      }
    }

    if (!payload.subject || typeof payload.subject !== "string" || payload.subject.trim().length === 0) {
      return "Field 'subject' is required and must be non-empty.";
    }

    if (!payload.html && !payload.text && !payload.body) {
      return "At least one of 'html', 'text', or 'body' is required.";
    }

    return null;
  }

  /**
   * Exhaustively translates Resend API HTTP status codes and error JSON into standardized IntegrationFailure.
   */
  public translateResendError(
    statusCode: number,
    errorBody: Record<string, unknown>,
    retryAfterSeconds?: number
  ): IntegrationFailure {
    const rawMessage =
      (typeof errorBody.message === "string" ? errorBody.message : undefined) ||
      (typeof errorBody.error === "string" ? errorBody.error : undefined) ||
      `Resend API error with HTTP ${statusCode}`;

    const rawName = (typeof errorBody.name === "string" ? errorBody.name : undefined);

    switch (statusCode) {
      case 401:
      case 403:
        return {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: statusCode,
          providerRawCode: rawName || String(statusCode),
          providerRawMessage: rawMessage,
        };
      case 400:
      case 422:
        return {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: statusCode,
          providerRawCode: rawName || String(statusCode),
          providerRawMessage: rawMessage,
        };
      case 404:
        return {
          code: IntegrationFailureCode.RESOURCE_NOT_FOUND,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: 404,
          providerRawCode: rawName || "404",
          providerRawMessage: rawMessage,
        };
      case 429:
        return {
          code: IntegrationFailureCode.RATE_LIMITED,
          message: rawMessage,
          isRetryable: true,
          retryAfterSeconds: retryAfterSeconds ?? 30,
          httpStatusCode: 429,
          providerRawCode: rawName || "429",
          providerRawMessage: rawMessage,
        };
      case 500:
      case 502:
      case 503:
        return {
          code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
          message: rawMessage,
          isRetryable: true,
          httpStatusCode: statusCode,
          providerRawCode: rawName || String(statusCode),
          providerRawMessage: rawMessage,
        };
      case 504:
        return {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: rawMessage,
          isRetryable: true,
          httpStatusCode: 504,
          providerRawCode: rawName || "504",
          providerRawMessage: rawMessage,
        };
      default:
        return {
          code: statusCode >= 500 ? IntegrationFailureCode.SERVICE_UNAVAILABLE : IntegrationFailureCode.BAD_REQUEST,
          message: rawMessage,
          isRetryable: statusCode >= 500,
          httpStatusCode: statusCode,
          providerRawCode: rawName || String(statusCode),
          providerRawMessage: rawMessage,
        };
    }
  }
}

/**
 * Verifies Svix webhook signatures matching Resend's scheme.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
  toleranceSeconds: number = 300
): boolean {
  const svixId = headers.get("svix-id") || headers.get("webhook-id");
  const svixTimestamp = headers.get("svix-timestamp") || headers.get("webhook-timestamp");
  const svixSignature = headers.get("svix-signature") || headers.get("webhook-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  // Validate timestamp tolerance
  const timestampNum = parseInt(svixTimestamp, 10);
  if (isNaN(timestampNum)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampNum) > toleranceSeconds) {
    return false;
  }

  // Extract secret key buffer (strip 'whsec_' prefix if present and decode base64)
  const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const secretBuffer = Buffer.from(cleanSecret, "base64");

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const computedSignature = crypto
    .createHmac("sha256", secretBuffer)
    .update(signedContent)
    .digest("base64");

  const signatures = svixSignature.split(" ");
  for (const sigItem of signatures) {
    const parts = sigItem.split(",");
    if (parts.length === 2 && parts[0] === "v1") {
      const candidate = parts[1];
      try {
        const candidateBuf = Buffer.from(candidate, "base64");
        const computedBuf = Buffer.from(computedSignature, "base64");
        if (candidateBuf.length === computedBuf.length && crypto.timingSafeEqual(candidateBuf, computedBuf)) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }

  return false;
}
