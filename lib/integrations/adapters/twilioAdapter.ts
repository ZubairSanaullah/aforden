/**
 * Phase 1.17.7 — Twilio Provider Adapter
 * Real, network-facing provider adapter implementing IntegrationAdapter for SMS_SEND.
 * Uses Twilio REST API, X-Twilio-Signature (HMAC-SHA1) webhook verification, and exhaustive error translations.
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

export interface TwilioSmsPayload {
  to: string;
  body?: string;
  text?: string;
  message?: string;
  from?: string;
  messagingServiceSid?: string;
  mediaUrl?: string | string[];
}

export class TwilioAdapter implements IntegrationAdapter {
  public readonly integrationId = "twilio";
  public readonly displayName = "Twilio";
  public readonly version = "1.0.0";

  public getCapabilities(): readonly IntegrationCapability[] {
    return [IntegrationCapability.SMS_SEND];
  }

  /**
   * Validates Account SID and Auth Token against Twilio REST API.
   */
  public async connect(
    connection: IntegrationConnection,
    authPayload?: unknown
  ): Promise<ConnectResult> {
    const creds = this.extractCredentials(authPayload, connection);

    if (!creds.accountSid || !creds.authToken) {
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
          message: "Twilio accountSid and authToken are required to connect.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    const start = Date.now();
    try {
      const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}.json`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "User-Agent": "Aforden-Integration-Engine/1.0",
          },
        }
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const failure = this.translateTwilioError(response.status, errorBody);
        return {
          success: false,
          connectionStatus: IntegrationConnectionStatus.ERROR,
          credentialReference: {
            secretId: `sec_twilio_${connection.id.slice(0, 8)}`,
            version: 1,
            keyVaultProvider: "LOCAL_ENCRYPTED_DB",
            algorithm: "AES_256_GCM",
            fingerprint: `sha256:${crypto.createHash("sha256").update(creds.authToken).digest("hex").slice(0, 16)}`,
          },
          failure,
        };
      }

      const accountData = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      return {
        success: true,
        connectionStatus: IntegrationConnectionStatus.CONNECTED,
        externalAccountId: creds.accountSid,
        externalAccountName: (accountData.friendly_name as string) || "Twilio SMS Account",
        credentialReference: {
          secretId: `sec_twilio_${connection.id.slice(0, 8)}`,
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: `sha256:${crypto.createHash("sha256").update(creds.authToken).digest("hex").slice(0, 16)}`,
        },
        metadata: {
          accountSid: creds.accountSid,
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
          message: err instanceof Error ? err.message : "Failed to connect to Twilio API.",
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
   * Health check ping against Twilio Accounts endpoint.
   */
  public async testConnection(
    connection: IntegrationConnection,
    secretReference: IntegrationSecretReference
  ): Promise<TestResult> {
    const creds = this.extractCredentialsFromSecret(secretReference, connection);
    const start = Date.now();

    if (!creds.accountSid || !creds.authToken) {
      return {
        success: false,
        latencyMs: 0,
        checkedAt: new Date(),
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "Twilio accountSid or authToken missing in secret reference.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    try {
      const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}.json`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "User-Agent": "Aforden-Integration-Engine/1.0",
          },
        }
      );

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const failure = this.translateTwilioError(response.status, errorBody);
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
          accountSid: creds.accountSid,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
        failure: {
          code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
          message: err instanceof Error ? err.message : "Twilio health check failed.",
          isRetryable: true,
          httpStatusCode: 503,
        },
      };
    }
  }

  /**
   * Dispatches outbound SMS message via Twilio Messages API.
   */
  public async execute(
    request: IntegrationExecutionRequest
  ): Promise<IntegrationExecutionResult> {
    const start = Date.now();

    if (request.capability !== IntegrationCapability.SMS_SEND) {
      return {
        success: false,
        capability: request.capability,
        action: request.action,
        durationMs: Date.now() - start,
        failure: {
          code: IntegrationFailureCode.CAPABILITY_UNSUPPORTED,
          message: `Capability '${request.capability}' is not supported by TwilioAdapter.`,
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const payload = (request.payload || {}) as unknown as TwilioSmsPayload;
    const messageBody = payload.body || payload.text || payload.message;

    // Validate payload
    if (!payload.to || typeof payload.to !== "string" || payload.to.trim().length === 0) {
      return {
        success: false,
        capability: IntegrationCapability.SMS_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: "Field 'to' (phone number) is required.",
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    if (!messageBody || typeof messageBody !== "string" || messageBody.trim().length === 0) {
      return {
        success: false,
        capability: IntegrationCapability.SMS_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: "Field 'body' (or 'text'/'message') is required and must be non-empty.",
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const creds = this.extractCredentialsFromSecret(
      request.secretReference,
      { configJson: request.connectionConfig } as unknown as IntegrationConnection
    );

    if (!creds.accountSid || !creds.authToken) {
      return {
        success: false,
        capability: IntegrationCapability.SMS_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 401,
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "Twilio accountSid or authToken not configured.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    const fromNumber =
      payload.from ||
      (request.connectionConfig?.fromPhoneNumber as string) ||
      process.env.TWILIO_FROM_PHONE_NUMBER;

    const messagingServiceSid =
      payload.messagingServiceSid ||
      (request.connectionConfig?.messagingServiceSid as string);

    if (!fromNumber && !messagingServiceSid) {
      return {
        success: false,
        capability: IntegrationCapability.SMS_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: "Either 'from' (phone number) or 'messagingServiceSid' is required.",
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    // Prepare Form URL-encoded body
    const formParams = new URLSearchParams();
    formParams.set("To", payload.to);
    formParams.set("Body", messageBody);
    if (fromNumber) {
      formParams.set("From", fromNumber);
    }
    if (messagingServiceSid) {
      formParams.set("MessagingServiceSid", messagingServiceSid);
    }

    try {
      const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Aforden-Integration-Engine/1.0",
          },
          body: formParams.toString(),
        }
      );

      const durationMs = Date.now() - start;
      const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const failure = this.translateTwilioError(response.status, responseJson);
        return {
          success: false,
          capability: IntegrationCapability.SMS_SEND,
          action: request.action,
          durationMs,
          rawResponseStatus: response.status,
          failure,
        };
      }

      return {
        success: true,
        capability: IntegrationCapability.SMS_SEND,
        action: request.action,
        durationMs,
        rawResponseStatus: response.status,
        providerRequestId: typeof responseJson.sid === "string" ? responseJson.sid : undefined,
        data: {
          messageSid: responseJson.sid,
          to: responseJson.to || payload.to,
          from: responseJson.from || fromNumber,
          status: responseJson.status,
          numSegments: responseJson.num_segments,
          dateCreated: responseJson.date_created,
          idempotencyKey: request.idempotencyKey,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        capability: IntegrationCapability.SMS_SEND,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 504,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: err instanceof Error ? err.message : "Network error contacting Twilio API.",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
  }

  /**
   * Normalizes incoming Twilio status callback webhooks.
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

    const creds = this.extractCredentialsFromSecret(secretReference, connection);
    const signature = headers.get("x-twilio-signature");

    if (creds.authToken && signature) {
      const webhookUrl =
        headers.get("x-original-url") ||
        headers.get("x-forwarded-url") ||
        `https://app.aforden.com/api/integrations/webhooks/endpoints/${connection.id}`;

      const payloadRecord = payload as Record<string, string>;
      const isValid = verifyTwilioSignature(webhookUrl, payloadRecord, signature, creds.authToken);
      if (!isValid) {
        return null;
      }
    }

    const payloadObj = payload as Record<string, unknown>;
    const messageSid = (payloadObj.MessageSid || payloadObj.SmsSid || payloadObj.sid || crypto.randomUUID()) as string;
    const messageStatus = (payloadObj.MessageStatus || payloadObj.SmsStatus || "unknown") as string;
    const eventType = `sms.${messageStatus.toLowerCase()}`;

    const rawPayloadHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    return {
      eventId: `evt_twilio_${messageSid}`,
      eventType,
      occurredAt: new Date(),
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      entityType: "SmsMessage",
      entityId: messageSid,
      payload: {
        messageSid,
        to: payloadObj.To,
        from: payloadObj.From,
        status: messageStatus,
        errorCode: payloadObj.ErrorCode,
        errorMessage: payloadObj.ErrorMessage,
        rawEvent: payloadObj,
      },
      rawPayloadHash,
    };
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private extractCredentials(
    authPayload: unknown,
    connection: IntegrationConnection
  ): { accountSid: string | null; authToken: string | null } {
    let accountSid: string | null = null;
    let authToken: string | null = null;

    if (authPayload && typeof authPayload === "object") {
      const obj = authPayload as Record<string, unknown>;
      if (typeof obj.accountSid === "string") accountSid = obj.accountSid.trim();
      if (typeof obj.authToken === "string") authToken = obj.authToken.trim();
    }

    const config = connection.configJson as Record<string, unknown> | null;
    if (!accountSid && config && typeof config.accountSid === "string") {
      accountSid = config.accountSid.trim();
    }
    if (!authToken && config && typeof config.authToken === "string") {
      authToken = config.authToken.trim();
    }

    return {
      accountSid: accountSid || process.env.TWILIO_ACCOUNT_SID || null,
      authToken: authToken || process.env.TWILIO_AUTH_TOKEN || null,
    };
  }

  private extractCredentialsFromSecret(
    secretReference: IntegrationSecretReference | undefined,
    connection: IntegrationConnection
  ): { accountSid: string | null; authToken: string | null } {
    let accountSid: string | null = null;
    let authToken: string | null = null;

    if (typeof secretReference?.secretPayload === "string") {
      try {
        const parsed = JSON.parse(secretReference.secretPayload);
        if (typeof parsed.accountSid === "string") accountSid = parsed.accountSid.trim();
        if (typeof parsed.authToken === "string") authToken = parsed.authToken.trim();
      } catch {
        authToken = secretReference.secretPayload.trim();
      }
    } else if (secretReference?.secretPayload && typeof secretReference.secretPayload === "object") {
      const obj = secretReference.secretPayload as Record<string, unknown>;
      if (typeof obj.accountSid === "string") accountSid = obj.accountSid.trim();
      if (typeof obj.authToken === "string") authToken = obj.authToken.trim();
    }

    const config = connection.configJson as Record<string, unknown> | null;
    if (!accountSid && config && typeof config.accountSid === "string") {
      accountSid = config.accountSid.trim();
    }
    if (!authToken && config && typeof config.authToken === "string") {
      authToken = config.authToken.trim();
    }

    return {
      accountSid: accountSid || process.env.TWILIO_ACCOUNT_SID || null,
      authToken: authToken || process.env.TWILIO_AUTH_TOKEN || null,
    };
  }

  /**
   * Exhaustively translates Twilio REST API error responses to standardized IntegrationFailure.
   */
  public translateTwilioError(
    statusCode: number,
    errorBody: Record<string, unknown>
  ): IntegrationFailure {
    const rawCode = typeof errorBody.code === "number" ? errorBody.code : undefined;
    const rawMessage =
      (typeof errorBody.message === "string" ? errorBody.message : undefined) ||
      `Twilio error HTTP ${statusCode}`;

    // Specific Twilio error codes
    switch (rawCode) {
      case 20003: // Authentication Error
        return {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: 401,
          providerRawCode: "20003",
          providerRawMessage: rawMessage,
        };
      case 21211: // Invalid 'To' Phone Number
      case 21614: // 'To' number is not a valid mobile number
      case 21606: // 'From' phone number is not valid
      case 21610: // Message cannot be sent to unsubscribed recipient
        return {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: 400,
          providerRawCode: String(rawCode),
          providerRawMessage: rawMessage,
        };
      case 20429: // Too Many Requests
        return {
          code: IntegrationFailureCode.RATE_LIMITED,
          message: rawMessage,
          isRetryable: true,
          retryAfterSeconds: 30,
          httpStatusCode: 429,
          providerRawCode: "20429",
          providerRawMessage: rawMessage,
        };
      case 20500: // Internal Server Error
        return {
          code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
          message: rawMessage,
          isRetryable: true,
          httpStatusCode: 503,
          providerRawCode: "20500",
          providerRawMessage: rawMessage,
        };
    }

    // HTTP status code fallbacks
    switch (statusCode) {
      case 401:
      case 403:
        return {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: statusCode,
          providerRawCode: String(rawCode || statusCode),
          providerRawMessage: rawMessage,
        };
      case 400:
      case 422:
        return {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: statusCode,
          providerRawCode: String(rawCode || statusCode),
          providerRawMessage: rawMessage,
        };
      case 429:
        return {
          code: IntegrationFailureCode.RATE_LIMITED,
          message: rawMessage,
          isRetryable: true,
          retryAfterSeconds: 30,
          httpStatusCode: 429,
          providerRawCode: String(rawCode || 429),
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
          providerRawCode: String(rawCode || statusCode),
          providerRawMessage: rawMessage,
        };
      case 504:
        return {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: rawMessage,
          isRetryable: true,
          httpStatusCode: 504,
          providerRawCode: String(rawCode || 504),
          providerRawMessage: rawMessage,
        };
      default:
        return {
          code: statusCode >= 500 ? IntegrationFailureCode.SERVICE_UNAVAILABLE : IntegrationFailureCode.BAD_REQUEST,
          message: rawMessage,
          isRetryable: statusCode >= 500,
          httpStatusCode: statusCode,
          providerRawCode: String(rawCode || statusCode),
          providerRawMessage: rawMessage,
        };
    }
  }
}

/**
 * Computes and verifies Twilio X-Twilio-Signature (HMAC-SHA1 over URL + sorted parameters).
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string
): boolean {
  if (!url || !signature || !authToken) {
    return false;
  }

  // Sort parameter keys alphabetically and concatenate key + value
  const sortedKeys = Object.keys(params || {}).sort();
  let dataToSign = url;
  for (const key of sortedKeys) {
    dataToSign += `${key}${params[key]}`;
  }

  const computedSignature = crypto
    .createHmac("sha1", authToken)
    .update(dataToSign)
    .digest("base64");

  try {
    const candidateBuf = Buffer.from(signature, "base64");
    const computedBuf = Buffer.from(computedSignature, "base64");
    if (candidateBuf.length !== computedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(candidateBuf, computedBuf);
  } catch {
    return false;
  }
}
