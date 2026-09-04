/**
 * Phase 1.23.3 — Brevo Provider Adapter
 * Real, network-facing provider adapter implementing IntegrationAdapter for EMAIL_SEND.
 * Uses Brevo v3 Transactional Email REST API, Bearer/secret webhook authentication,
 * and exhaustive error translation to standardized IntegrationFailure.
 */

import crypto from "crypto";
import { timingSafeEqualStrings } from "@/lib/services/platform/security/constantTime";
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

export const BREVO_TRANSACTIONAL_EVENTS = [
  "delivered",
  "hardBounce",
  "softBounce",
  "blocked",
  "spam",
  "opened",
  "click",
  "unsubscribed",
] as const;

export interface BrevoEmailPayload {
  to: string | string[] | Array<{ email: string; name?: string }>;
  subject: string;
  html?: string;
  text?: string;
  body?: string;
  from?: string | { email: string; name?: string };
  cc?: string | string[] | Array<{ email: string; name?: string }>;
  bcc?: string | string[] | Array<{ email: string; name?: string }>;
  replyTo?: string | { email: string; name?: string };
  headers?: Record<string, string>;
  tags?: string[] | Array<{ name: string; value: string }>;
}

export class BrevoAdapter implements IntegrationAdapter {
  public readonly integrationId = "brevo";
  public readonly displayName = "Brevo";
  public readonly version = "1.0.0";

  public getCapabilities(): readonly IntegrationCapability[] {
    return [
      IntegrationCapability.EMAIL_SEND,
      IntegrationCapability.WEBHOOK_RECEIVE,
    ];
  }

  /**
   * Validates API credentials by querying the Brevo account endpoint.
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
          message: "Brevo API key is missing from authPayload or connection config.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    const start = Date.now();
    try {
      const response = await fetch("https://api.brevo.com/v3/account", {
        method: "GET",
        headers: {
          "api-key": apiKey,
          "User-Agent": "Aforden-Integration-Engine/1.0",
        },
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const failure = this.translateBrevoError(response.status, errorBody);
        return {
          success: false,
          connectionStatus: IntegrationConnectionStatus.ERROR,
          credentialReference: {
            secretId: `sec_brevo_${connection.id.slice(0, 8)}`,
            version: 1,
            keyVaultProvider: "LOCAL_ENCRYPTED_DB",
            algorithm: "AES_256_GCM",
            fingerprint: `sha256:${crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`,
          },
          failure,
        };
      }

      const accountData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const email = typeof accountData.email === "string" ? accountData.email : "Brevo Account";

      const config = (connection.configJson as Record<string, unknown>) || {};
      const skipWebhookRegistration = config.skipWebhookRegistration === true;

      let webhookId: number | string | undefined;
      let webhookUrl: string | undefined;
      let endpointSlug: string | undefined;

      // Generate secure high-entropy webhook secret
      const webhookSecret = `whsec_brevo_${crypto.randomBytes(24).toString("hex")}`;

      if (!skipWebhookRegistration) {
        const baseUrl =
          (config.webhookBaseUrl as string) ||
          process.env.APP_URL ||
          process.env.NEXT_PUBLIC_APP_URL ||
          "https://app.aforden.com";
        endpointSlug =
          (config.webhookEndpointSlug as string) ||
          (connection.id ? `brevo_${connection.id}` : `brevo_${crypto.randomUUID().slice(0, 8)}`);
        webhookUrl = `${baseUrl.replace(/\/+$/, "")}/api/integrations/webhooks/${endpointSlug}`;

        const webhookResponse = await fetch("https://api.brevo.com/v3/webhooks", {
          method: "POST",
          headers: {
            "api-key": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Aforden-Integration-Engine/1.0",
          },
          body: JSON.stringify({
            url: webhookUrl,
            description: `Aforden Transactional Email Webhook (${connection.workspaceId})`,
            events: [...BREVO_TRANSACTIONAL_EVENTS],
            type: "transactional",
            headers: {
              "X-Aforden-Webhook-Secret": webhookSecret,
            },
          }),
        });

        if (!webhookResponse.ok) {
          const errorBody = (await webhookResponse.json().catch(() => ({}))) as Record<string, unknown>;
          const failure = this.translateBrevoError(webhookResponse.status, errorBody);
          return {
            success: false,
            connectionStatus: IntegrationConnectionStatus.ERROR,
            credentialReference: {
              secretId: `sec_brevo_${connection.id.slice(0, 8)}`,
              version: 1,
              keyVaultProvider: "LOCAL_ENCRYPTED_DB",
              algorithm: "AES_256_GCM",
              fingerprint: `sha256:${crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`,
            },
            failure: {
              ...failure,
              message: `Brevo webhook provisioning failed: ${failure.message}`,
            },
          };
        }

        const webhookData = (await webhookResponse.json().catch(() => ({}))) as Record<string, unknown>;
        webhookId =
          typeof webhookData.id === "number" || typeof webhookData.id === "string"
            ? webhookData.id
            : undefined;
      }

      return {
        success: true,
        connectionStatus: IntegrationConnectionStatus.CONNECTED,
        externalAccountId: `brevo_${crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}`,
        externalAccountName: email,
        credentialReference: {
          secretId: `sec_brevo_${connection.id.slice(0, 8)}`,
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: `sha256:${crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`,
          secretPayload: JSON.stringify({
            apiKey,
            webhookSecret,
            webhookId,
          }),
        },
        metadata: {
          connectedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
          plan: accountData.plan,
          webhookId,
          webhookUrl,
          endpointSlug,
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
          message: err instanceof Error ? err.message : "Failed to connect to Brevo API.",
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
   * Performs a lightweight health check ping against Brevo API.
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
      const response = await fetch("https://api.brevo.com/v3/account", {
        method: "GET",
        headers: {
          "api-key": apiKey,
          "User-Agent": "Aforden-Integration-Engine/1.0",
        },
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const failure = this.translateBrevoError(response.status, errorBody);
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
          message: err instanceof Error ? err.message : "Brevo health check failed.",
          isRetryable: true,
          httpStatusCode: 503,
        },
      };
    }
  }

  /**
   * Dispatches transactional email via Brevo v3 REST API.
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
          message: `Capability '${request.capability}' is not supported by BrevoAdapter.`,
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const payload = (request.payload || {}) as unknown as BrevoEmailPayload;

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
          message: "No decrypted API key found for Brevo connection.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    const fromAddress =
      payload.from ||
      (request.connectionConfig?.fromEmail as string) ||
      process.env.EMAIL_FROM ||
      "notifications@aforden.com";

    const sender = this.formatSender(fromAddress);
    const recipients = this.formatRecipients(payload.to);
    const htmlContent = payload.html || payload.body;
    const textContent = payload.text || (!payload.html ? payload.body : undefined);

    const bodyData: Record<string, unknown> = {
      sender,
      to: recipients,
      subject: payload.subject,
      ...(htmlContent ? { htmlContent } : {}),
      ...(textContent ? { textContent } : {}),
    };

    if (payload.replyTo) {
      bodyData.replyTo = typeof payload.replyTo === "string" ? { email: payload.replyTo } : payload.replyTo;
    }
    if (payload.cc) {
      bodyData.cc = this.formatRecipients(payload.cc);
    }
    if (payload.bcc) {
      bodyData.bcc = this.formatRecipients(payload.bcc);
    }
    if (payload.headers) {
      bodyData.headers = payload.headers;
    }
    if (payload.tags) {
      bodyData.tags = Array.isArray(payload.tags)
        ? payload.tags.map((t) => (typeof t === "string" ? t : `${t.name}:${t.value}`))
        : [];
    }

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          "User-Agent": "Aforden-Integration-Engine/1.0",
        },
        body: JSON.stringify(bodyData),
      });

      const durationMs = Date.now() - start;
      const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const retryAfterHeader = response.headers?.get ? response.headers.get("retry-after") : undefined;
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

        const failure = this.translateBrevoError(
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

      const messageId = typeof responseJson.messageId === "string" ? responseJson.messageId : undefined;

      return {
        success: true,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs,
        rawResponseStatus: response.status,
        providerRequestId: messageId,
        data: {
          messageId,
          to: payload.to,
          from: sender.email,
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
          message: err instanceof Error ? err.message : "Network error contacting Brevo API.",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
  }

  /**
   * Inbound webhook reception for Brevo transactional email events.
   * Authenticates incoming request using the per-connection secret embedded
   * in custom header 'X-Aforden-Webhook-Secret' (or fallback custom headers)
   * compared via timingSafeEqualStrings.
   * Normalizes events into canonical IntegrationEvent schema with entityType 'EmailMessage'.
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

    const webhookSecret = this.extractWebhookSecret(secretReference, connection);
    if (!webhookSecret) {
      return null;
    }

    const receivedSecret =
      headers.get("x-aforden-webhook-secret") ||
      headers.get("x-webhook-secret") ||
      headers.get("x-brevo-webhook-secret") ||
      headers.get("x-webhook-signature");

    if (!receivedSecret || !timingSafeEqualStrings(receivedSecret, webhookSecret)) {
      return null;
    }

    const payloadObj = payload as Record<string, unknown>;
    const rawEvent = typeof payloadObj.event === "string" ? payloadObj.event : "unknown";
    const email = typeof payloadObj.email === "string" ? payloadObj.email : undefined;
    const rawMessageId = payloadObj["message-id"] || payloadObj.messageId || payloadObj.id;
    const messageId = typeof rawMessageId === "string" ? rawMessageId : String(rawMessageId || crypto.randomUUID());

    const normalizedStatus = this.normalizeBrevoEventType(rawEvent);
    const eventType = `email.${normalizedStatus}`;

    let occurredAt = new Date();
    if (payloadObj.date && typeof payloadObj.date === "string") {
      const parsedDate = new Date(payloadObj.date);
      if (!isNaN(parsedDate.getTime())) {
        occurredAt = parsedDate;
      }
    } else if (typeof payloadObj.ts_event === "number") {
      occurredAt = new Date(payloadObj.ts_event * 1000);
    } else if (typeof payloadObj.ts === "number") {
      occurredAt = new Date(payloadObj.ts * 1000);
    }

    // Synthetic idempotency key derived from messageId + rawEvent + date + link + reason
    // Disambiguates distinct rapid events (e.g. multiple clicks on different URLs within the same second)
    const dateStr = payloadObj.date || payloadObj.ts_event || payloadObj.ts || occurredAt.toISOString();
    const linkStr = typeof payloadObj.link === "string" ? payloadObj.link : "";
    const reasonStr = typeof payloadObj.reason === "string" ? payloadObj.reason : "";
    const dedupToken = `${messageId}:${rawEvent}:${dateStr}:${linkStr}:${reasonStr}`;
    const dedupHash = crypto.createHash("sha256").update(dedupToken).digest("hex").slice(0, 32);
    const eventId = `evt_brevo_${dedupHash}`;

    const rawPayloadHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    return {
      eventId,
      eventType,
      occurredAt,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      entityType: "EmailMessage",
      entityId: messageId,
      payload: {
        messageId,
        email,
        event: rawEvent,
        status: normalizedStatus,
        subject: payloadObj.subject,
        tag: payloadObj.tag,
        tags: payloadObj.tags,
        reason: payloadObj.reason,
        link: payloadObj.link,
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
    return process.env.BREVO_API_KEY || null;
  }

  private extractApiKeyFromSecret(
    secretReference: IntegrationSecretReference | undefined,
    connection: IntegrationConnection
  ): string | null {
    if (typeof secretReference?.secretPayload === "string" && secretReference.secretPayload.trim().length > 0) {
      const str = secretReference.secretPayload.trim();
      if (str.startsWith("{")) {
        try {
          const parsed = JSON.parse(str);
          if (typeof parsed.apiKey === "string" && parsed.apiKey.trim().length > 0) {
            return parsed.apiKey.trim();
          }
        } catch {
          // ignore JSON parse error
        }
      }
      return str;
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
    return process.env.BREVO_API_KEY || null;
  }

  private extractWebhookSecret(
    secretReference: IntegrationSecretReference | undefined,
    connection: IntegrationConnection
  ): string | null {
    if (typeof secretReference?.secretPayload === "string" && secretReference.secretPayload.trim().length > 0) {
      const str = secretReference.secretPayload.trim();
      if (str.startsWith("{")) {
        try {
          const parsed = JSON.parse(str);
          if (typeof parsed.webhookSecret === "string" && parsed.webhookSecret.trim().length > 0) {
            return parsed.webhookSecret.trim();
          }
        } catch {
          // ignore JSON parse error
        }
      }
    }
    if (secretReference?.secretPayload && typeof secretReference.secretPayload === "object") {
      const obj = secretReference.secretPayload as Record<string, unknown>;
      if (typeof obj.webhookSecret === "string" && obj.webhookSecret.trim().length > 0) {
        return obj.webhookSecret.trim();
      }
    }
    const config = connection.configJson as Record<string, unknown> | null;
    if (config && typeof config.webhookSecret === "string" && config.webhookSecret.trim().length > 0) {
      return config.webhookSecret.trim();
    }
    return process.env.BREVO_WEBHOOK_SECRET || null;
  }

  private normalizeBrevoEventType(event: string): string {
    switch (event) {
      case "delivered":
        return "delivered";
      case "hardBounce":
      case "hard_bounce":
        return "hard_bounce";
      case "softBounce":
      case "soft_bounce":
        return "soft_bounce";
      case "blocked":
        return "blocked";
      case "spam":
        return "spam";
      case "opened":
      case "uniqueOpened":
        return "opened";
      case "click":
        return "clicked";
      case "unsubscribed":
        return "unsubscribed";
      case "request":
      case "sent":
        return "sent";
      default:
        return event.toLowerCase();
    }
  }

  private formatSender(from: string | { email: string; name?: string }): { email: string; name?: string } {
    if (typeof from === "object" && from.email) {
      return from;
    }
    if (typeof from === "string") {
      const match = from.match(/^(?:([^<]+)\s+<)?([^>]+)>?$/);
      if (match) {
        const name = match[1]?.trim();
        const email = match[2]?.trim() || from;
        return name ? { name, email } : { email };
      }
      return { email: from };
    }
    return { email: "notifications@aforden.com" };
  }

  private formatRecipients(
    to: string | string[] | Array<{ email: string; name?: string }>
  ): Array<{ email: string; name?: string }> {
    if (Array.isArray(to)) {
      return to.map((item) => {
        if (typeof item === "string") {
          return { email: item };
        }
        return item;
      });
    }
    return [{ email: to }];
  }

  private validateEmailPayload(payload: BrevoEmailPayload): string | null {
    if (!payload.to) return "Field 'to' is required.";
    const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
    if (recipients.length === 0) return "At least one recipient in 'to' is required.";

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const item of recipients) {
      const email = typeof item === "string" ? item : item?.email;
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
   * Exhaustively translates Brevo API HTTP status codes and error JSON into standardized IntegrationFailure.
   */
  public translateBrevoError(
    statusCode: number,
    errorBody: Record<string, unknown>,
    retryAfterSeconds?: number
  ): IntegrationFailure {
    const rawMessage =
      (typeof errorBody.message === "string" ? errorBody.message : undefined) ||
      (typeof errorBody.error === "string" ? errorBody.error : undefined) ||
      `Brevo API error with HTTP ${statusCode}`;

    const rawCode = typeof errorBody.code === "string" ? errorBody.code : undefined;

    switch (statusCode) {
      case 401:
      case 403:
        return {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: statusCode,
          providerRawCode: rawCode || String(statusCode),
          providerRawMessage: rawMessage,
        };
      case 400:
      case 422:
        return {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: statusCode,
          providerRawCode: rawCode || String(statusCode),
          providerRawMessage: rawMessage,
        };
      case 404:
        return {
          code: IntegrationFailureCode.RESOURCE_NOT_FOUND,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: 404,
          providerRawCode: rawCode || "404",
          providerRawMessage: rawMessage,
        };
      case 429:
        return {
          code: IntegrationFailureCode.RATE_LIMITED,
          message: rawMessage,
          isRetryable: true,
          retryAfterSeconds: retryAfterSeconds ?? 30,
          httpStatusCode: 429,
          providerRawCode: rawCode || "429",
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
          providerRawCode: rawCode || String(statusCode),
          providerRawMessage: rawMessage,
        };
      case 504:
        return {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: rawMessage,
          isRetryable: true,
          httpStatusCode: 504,
          providerRawCode: rawCode || "504",
          providerRawMessage: rawMessage,
        };
      default:
        return {
          code: statusCode >= 500 ? IntegrationFailureCode.SERVICE_UNAVAILABLE : IntegrationFailureCode.BAD_REQUEST,
          message: rawMessage,
          isRetryable: statusCode >= 500,
          httpStatusCode: statusCode,
          providerRawCode: rawCode || String(statusCode),
          providerRawMessage: rawMessage,
        };
    }
  }
}
