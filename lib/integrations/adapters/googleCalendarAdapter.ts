/**
 * Phase 1.17.8 — Google Calendar Provider Adapter
 * Real, network-facing provider adapter implementing IntegrationAdapter for:
 * - CALENDAR_WRITE
 * - CALENDAR_READ
 *
 * Implements OAuth2 token refresh with concurrent in-flight mutex, Google API error translation,
 * and push notification header processing.
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
import {
  type OAuth2TokenPayload,
  refreshOAuth2TokenWithMutex,
} from "./oauth2Helper";

export class GoogleCalendarAdapter implements IntegrationAdapter {
  public readonly integrationId = "google_calendar";
  public readonly displayName = "Google Calendar";
  public readonly version = "1.0.0";

  public getCapabilities(): readonly IntegrationCapability[] {
    return [
      IntegrationCapability.CALENDAR_WRITE,
      IntegrationCapability.CALENDAR_READ,
    ];
  }

  /**
   * Completes OAuth2 authorization code handshake or token validation with Google APIs.
   */
  public async connect(
    connection: IntegrationConnection,
    authPayload?: unknown
  ): Promise<ConnectResult> {
    const start = Date.now();
    const config = (connection.configJson as Record<string, unknown>) || {};
    const clientId = (config.clientId as string) || process.env.GOOGLE_CLIENT_ID || "mock_google_client_id";
    const clientSecret = (config.clientSecret as string) || process.env.GOOGLE_CLIENT_SECRET || "mock_google_client_secret";

    let tokens = this.extractTokensFromAuthPayload(authPayload);

    // If an authorization code was passed, exchange it for tokens
    if (authPayload && typeof authPayload === "object" && "code" in authPayload) {
      const codeObj = authPayload as { code: string; redirectUri?: string };
      try {
        const bodyParams = new URLSearchParams();
        bodyParams.set("grant_type", "authorization_code");
        bodyParams.set("code", codeObj.code);
        bodyParams.set("client_id", clientId);
        bodyParams.set("client_secret", clientSecret);
        bodyParams.set("redirect_uri", codeObj.redirectUri || "https://app.aforden.com/api/integrations/oauth/callback");

        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: bodyParams.toString(),
        });

        if (!tokenRes.ok) {
          const errData = (await tokenRes.json().catch(() => ({}))) as Record<string, unknown>;
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
              code: IntegrationFailureCode.AUTHENTICATION_FAILED,
              message: `Google OAuth code exchange failed: ${JSON.stringify(errData)}`,
              isRetryable: false,
              httpStatusCode: tokenRes.status,
            },
          };
        }

        const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
        tokens = {
          accessToken: String(tokenJson.access_token),
          refreshToken: String(tokenJson.refresh_token),
          expiresAt: Date.now() + (Number(tokenJson.expires_in) || 3600) * 1000,
          tokenType: String(tokenJson.token_type || "Bearer"),
          scope: String(tokenJson.scope || ""),
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
            message: err instanceof Error ? err.message : "Failed to exchange Google OAuth code.",
            isRetryable: true,
            httpStatusCode: 504,
          },
        };
      }
    }

    if (!tokens.accessToken) {
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
          message: "Google Calendar accessToken or OAuth code is missing.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    // Health check ping against Google CalendarList endpoint
    try {
      const response = await fetch(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: "application/json",
            "User-Agent": "Aforden-Integration-Engine/1.0",
          },
        }
      );

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const failure = this.translateGoogleError(response.status, errorBody);
        return {
          success: false,
          connectionStatus: IntegrationConnectionStatus.ERROR,
          credentialReference: {
            secretId: `sec_gcal_${connection.id.slice(0, 8)}`,
            version: 1,
            keyVaultProvider: "LOCAL_ENCRYPTED_DB",
            algorithm: "AES_256_GCM",
            fingerprint: `sha256:${crypto.createHash("sha256").update(tokens.accessToken).digest("hex").slice(0, 16)}`,
          },
          failure,
        };
      }

      const listData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const items = (listData.items as Array<Record<string, unknown>>) || [];
      const primaryCalendar = items[0] || {};
      const primaryEmail = (primaryCalendar.id as string) || "primary";

      return {
        success: true,
        connectionStatus: IntegrationConnectionStatus.CONNECTED,
        externalAccountId: primaryEmail,
        externalAccountName: (primaryCalendar.summary as string) || `Google Calendar (${primaryEmail})`,
        credentialReference: {
          secretId: `sec_gcal_${connection.id.slice(0, 8)}`,
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: `sha256:${crypto.createHash("sha256").update(tokens.accessToken).digest("hex").slice(0, 16)}`,
          secretPayload: JSON.stringify(tokens),
        },
        metadata: {
          primaryCalendarId: primaryEmail,
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
          message: err instanceof Error ? err.message : "Network error connecting to Google Calendar API.",
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
   * Health check ping against Google CalendarList.
   */
  public async testConnection(
    connection: IntegrationConnection,
    secretReference: IntegrationSecretReference
  ): Promise<TestResult> {
    const start = Date.now();
    const tokens = await this.getValidTokens(secretReference, connection);

    if (!tokens?.accessToken) {
      return {
        success: false,
        latencyMs: 0,
        checkedAt: new Date(),
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "No valid OAuth2 tokens found for Google Calendar connection.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    try {
      const response = await fetch(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: "application/json",
            "User-Agent": "Aforden-Integration-Engine/1.0",
          },
        }
      );

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const failure = this.translateGoogleError(response.status, errorBody);
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
          message: err instanceof Error ? err.message : "Google Calendar health check failed.",
          isRetryable: true,
          httpStatusCode: 503,
        },
      };
    }
  }

  /**
   * Executes calendar actions:
   * - CALENDAR_WRITE
   * - CALENDAR_READ
   */
  public async execute(
    request: IntegrationExecutionRequest
  ): Promise<IntegrationExecutionResult> {
    const start = Date.now();
    const config = (request.connectionConfig as Record<string, unknown>) || {};

    const tokens = await this.getValidTokens(
      request.secretReference,
      { id: request.connectionId, configJson: config } as unknown as IntegrationConnection
    );

    if (!tokens?.accessToken) {
      return {
        success: false,
        capability: request.capability,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 401,
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "Google Calendar OAuth token is not configured or could not be refreshed.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    const calendarId = (config.calendarId as string) || (request.payload?.calendarId as string) || "primary";

    switch (request.capability) {
      case IntegrationCapability.CALENDAR_WRITE:
        return this.executeCalendarWrite(request, tokens.accessToken, calendarId, start);
      case IntegrationCapability.CALENDAR_READ:
        return this.executeCalendarRead(request, tokens.accessToken, calendarId, start);
      default:
        return {
          success: false,
          capability: request.capability,
          action: request.action,
          durationMs: Date.now() - start,
          failure: {
            code: IntegrationFailureCode.CAPABILITY_UNSUPPORTED,
            message: `Capability '${request.capability}' is not supported by GoogleCalendarAdapter.`,
            isRetryable: false,
            httpStatusCode: 400,
          },
        };
    }
  }

  /**
   * Normalizes Google Calendar push notifications.
   */
  public async handleWebhook(
    payload: unknown,
    headers: Headers,
    _secretReference: IntegrationSecretReference,
    connection: IntegrationConnection
  ): Promise<IntegrationEvent | null> {
    const channelId = headers.get("x-goog-channel-id");
    const resourceId = headers.get("x-goog-resource-id");
    const resourceState = headers.get("x-goog-resource-state") || "exists";

    if (!channelId || !resourceId) {
      return null;
    }

    const eventType = `calendar.event.${resourceState.toLowerCase()}`;
    const rawPayloadHash = crypto
      .createHash("sha256")
      .update(`${channelId}:${resourceId}:${resourceState}:${JSON.stringify(payload || {})}`)
      .digest("hex");

    return {
      eventId: `evt_gcal_${resourceId}_${Date.now()}`,
      eventType,
      occurredAt: new Date(),
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      entityType: "CalendarEvent",
      entityId: resourceId,
      payload: {
        channelId,
        resourceId,
        resourceState,
        channelToken: headers.get("x-goog-channel-token"),
        channelExpiration: headers.get("x-goog-channel-expiration"),
        rawPayload: payload,
      },
      rawPayloadHash,
    };
  }

  // =========================================================================
  // Private Subsystem Execution Methods
  // =========================================================================

  private async executeCalendarWrite(
    request: IntegrationExecutionRequest,
    accessToken: string,
    calendarId: string,
    start: number
  ): Promise<IntegrationExecutionResult> {
    const payload = (request.payload || {}) as Record<string, unknown>;
    const summary = (payload.summary as string) || (payload.title as string);

    if (!summary || typeof summary !== "string" || summary.trim().length === 0) {
      return {
        success: false,
        capability: IntegrationCapability.CALENDAR_WRITE,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: "Field 'summary' (or 'title') is required for calendar write.",
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const startTime = payload.start || { dateTime: new Date().toISOString() };
    const endTime =
      payload.end || {
        dateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };

    const gcalEventBody = {
      summary,
      description: payload.description,
      start: typeof startTime === "string" ? { dateTime: startTime } : startTime,
      end: typeof endTime === "string" ? { dateTime: endTime } : endTime,
      location: payload.location,
      attendees: payload.attendees,
    };

    const isUpdate = typeof payload.eventId === "string" && payload.eventId.trim().length > 0;
    const url = isUpdate
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(payload.eventId as string)}`
      : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    try {
      const response = await fetch(url, {
        method: isUpdate ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Aforden-Integration-Engine/1.0",
        },
        body: JSON.stringify(gcalEventBody),
      });

      const durationMs = Date.now() - start;
      const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const failure = this.translateGoogleError(response.status, responseJson);
        return {
          success: false,
          capability: IntegrationCapability.CALENDAR_WRITE,
          action: request.action,
          durationMs,
          rawResponseStatus: response.status,
          failure,
        };
      }

      const eventId = String(responseJson.id || "unknown");

      return {
        success: true,
        capability: IntegrationCapability.CALENDAR_WRITE,
        action: request.action,
        durationMs,
        rawResponseStatus: response.status,
        providerRequestId: eventId,
        data: {
          eventId,
          summary: responseJson.summary,
          htmlLink: responseJson.htmlLink,
          status: responseJson.status || "confirmed",
          start: responseJson.start,
          end: responseJson.end,
          idempotencyKey: request.idempotencyKey,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        capability: IntegrationCapability.CALENDAR_WRITE,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 504,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: err instanceof Error ? err.message : "Network error writing Google Calendar event.",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
  }

  private async executeCalendarRead(
    request: IntegrationExecutionRequest,
    accessToken: string,
    calendarId: string,
    start: number
  ): Promise<IntegrationExecutionResult> {
    const payload = (request.payload || {}) as Record<string, unknown>;
    const timeMin = (payload.timeMin as string) || new Date().toISOString();
    const timeMax = (payload.timeMax as string) || new Date(Date.now() + 7 * 86400000).toISOString();
    const maxResults = String(payload.maxResults || 250);

    const queryParams = new URLSearchParams({
      timeMin,
      timeMax,
      maxResults,
      singleEvents: "true",
      orderBy: "startTime",
    });

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${queryParams.toString()}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": "Aforden-Integration-Engine/1.0",
        },
      });

      const durationMs = Date.now() - start;
      const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const failure = this.translateGoogleError(response.status, responseJson);
        return {
          success: false,
          capability: IntegrationCapability.CALENDAR_READ,
          action: request.action,
          durationMs,
          rawResponseStatus: response.status,
          failure,
        };
      }

      const items = (responseJson.items as Array<Record<string, unknown>>) || [];

      return {
        success: true,
        capability: IntegrationCapability.CALENDAR_READ,
        action: request.action,
        durationMs,
        rawResponseStatus: response.status,
        data: {
          calendarId,
          itemCount: items.length,
          items,
          timeZone: responseJson.timeZone,
          idempotencyKey: request.idempotencyKey,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        capability: IntegrationCapability.CALENDAR_READ,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 504,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: err instanceof Error ? err.message : "Network error reading Google Calendar.",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
  }

  // =========================================================================
  // Private Helper & Token Resolution Methods
  // =========================================================================

  private extractTokensFromAuthPayload(authPayload: unknown): OAuth2TokenPayload {
    if (typeof authPayload === "string") {
      try {
        return JSON.parse(authPayload);
      } catch {
        return { accessToken: authPayload };
      }
    }
    if (authPayload && typeof authPayload === "object") {
      return authPayload as OAuth2TokenPayload;
    }
    return { accessToken: "" };
  }

  private async getValidTokens(
    secretReference: IntegrationSecretReference | undefined,
    connection: IntegrationConnection
  ): Promise<OAuth2TokenPayload | null> {
    const rawTokens = this.extractTokensFromAuthPayload(secretReference?.secretPayload);
    if (!rawTokens.accessToken && !rawTokens.refreshToken) {
      return null;
    }

    const config = (connection.configJson as Record<string, unknown>) || {};
    const clientId = (config.clientId as string) || process.env.GOOGLE_CLIENT_ID || "mock_google_client_id";
    const clientSecret = (config.clientSecret as string) || process.env.GOOGLE_CLIENT_SECRET || "mock_google_client_secret";

    return refreshOAuth2TokenWithMutex({
      connectionId: connection.id,
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      clientId,
      clientSecret,
      currentTokens: rawTokens,
      useBasicAuth: false,
    });
  }

  /**
   * Exhaustively translates Google API errors to standardized IntegrationFailure.
   */
  public translateGoogleError(
    statusCode: number,
    errorBody: Record<string, unknown>
  ): IntegrationFailure {
    const errorObj = (errorBody.error as Record<string, unknown>) || {};
    const errorList = (errorObj.errors as Array<Record<string, unknown>>) || [];
    const firstError = errorList[0] || {};

    const rawReason = (firstError.reason as string) || (errorObj.status as string) || String(statusCode);
    const rawMessage = (errorObj.message as string) || (firstError.message as string) || `Google Calendar error HTTP ${statusCode}`;

    // Google specific error reasons
    if (rawReason === "rateLimitExceeded" || rawReason === "userRateLimitExceeded" || statusCode === 429) {
      return {
        code: IntegrationFailureCode.RATE_LIMITED,
        message: rawMessage,
        isRetryable: true,
        retryAfterSeconds: 30,
        httpStatusCode: 429,
        providerRawCode: rawReason,
        providerRawMessage: rawMessage,
      };
    }

    if (rawReason === "backendError" || statusCode === 503 || statusCode === 500) {
      return {
        code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
        message: rawMessage,
        isRetryable: true,
        httpStatusCode: 503,
        providerRawCode: rawReason,
        providerRawMessage: rawMessage,
      };
    }

    switch (statusCode) {
      case 401:
      case 403:
        return {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: statusCode,
          providerRawCode: rawReason,
          providerRawMessage: rawMessage,
        };
      case 400:
      case 422:
        return {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: statusCode,
          providerRawCode: rawReason,
          providerRawMessage: rawMessage,
        };
      case 404:
        return {
          code: IntegrationFailureCode.RESOURCE_NOT_FOUND,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: 404,
          providerRawCode: rawReason,
          providerRawMessage: rawMessage,
        };
      case 504:
        return {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: rawMessage,
          isRetryable: true,
          httpStatusCode: 504,
          providerRawCode: rawReason,
          providerRawMessage: rawMessage,
        };
      default:
        return {
          code: statusCode >= 500 ? IntegrationFailureCode.SERVICE_UNAVAILABLE : IntegrationFailureCode.BAD_REQUEST,
          message: rawMessage,
          isRetryable: statusCode >= 500,
          httpStatusCode: statusCode,
          providerRawCode: rawReason,
          providerRawMessage: rawMessage,
        };
    }
  }
}
