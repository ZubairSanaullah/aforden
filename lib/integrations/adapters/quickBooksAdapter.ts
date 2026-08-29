/**
 * Phase 1.17.8 — QuickBooks Online Provider Adapter
 * Real, network-facing provider adapter implementing IntegrationAdapter for:
 * - ACCOUNTING_INVOICE_SYNC
 * - ACCOUNTING_PAYMENT_SYNC
 * - ACCOUNTING_CUSTOMER_SYNC
 *
 * Implements OAuth2 token refresh with concurrent in-flight mutex, Intuit Fault translation,
 * and intuit-signature webhook verification.
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

export class QuickBooksAdapter implements IntegrationAdapter {
  public readonly integrationId = "quickbooks_online";
  public readonly displayName = "QuickBooks Online";
  public readonly version = "1.0.0";

  public getCapabilities(): readonly IntegrationCapability[] {
    return [
      IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
      IntegrationCapability.ACCOUNTING_PAYMENT_SYNC,
      IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC,
    ];
  }

  /**
   * Completes OAuth2 authorization code handshake or token validation with QuickBooks Online.
   */
  public async connect(
    connection: IntegrationConnection,
    authPayload?: unknown
  ): Promise<ConnectResult> {
    const start = Date.now();
    const config = (connection.configJson as Record<string, unknown>) || {};
    const clientId = (config.clientId as string) || process.env.QUICKBOOKS_CLIENT_ID || "mock_qb_client_id";
    const clientSecret = (config.clientSecret as string) || process.env.QUICKBOOKS_CLIENT_SECRET || "mock_qb_client_secret";

    let tokens = this.extractTokensFromAuthPayload(authPayload);
    const realmId = tokens.realmId || (config.realmId as string) || "mock_realm_id";

    // If an authorization code was passed, exchange it for tokens
    if (authPayload && typeof authPayload === "object" && "code" in authPayload) {
      const codeObj = authPayload as { code: string; redirectUri?: string; realmId?: string };
      try {
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const bodyParams = new URLSearchParams();
        bodyParams.set("grant_type", "authorization_code");
        bodyParams.set("code", codeObj.code);
        bodyParams.set("redirect_uri", codeObj.redirectUri || "https://app.aforden.com/api/integrations/oauth/callback");

        const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
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
              message: `QuickBooks authorization code exchange failed: ${JSON.stringify(errData)}`,
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
          realmId: codeObj.realmId || realmId,
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
            message: err instanceof Error ? err.message : "Failed to exchange QuickBooks OAuth code.",
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
          message: "QuickBooks accessToken or OAuth code is missing.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    // Health check ping against CompanyInfo endpoint
    try {
      const response = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
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
        const failure = this.translateQuickBooksError(response.status, errorBody);
        return {
          success: false,
          connectionStatus: IntegrationConnectionStatus.ERROR,
          credentialReference: {
            secretId: `sec_qb_${connection.id.slice(0, 8)}`,
            version: 1,
            keyVaultProvider: "LOCAL_ENCRYPTED_DB",
            algorithm: "AES_256_GCM",
            fingerprint: `sha256:${crypto.createHash("sha256").update(tokens.accessToken).digest("hex").slice(0, 16)}`,
          },
          failure,
        };
      }

      const companyData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const companyInfo = (companyData.CompanyInfo as Record<string, unknown>) || {};

      return {
        success: true,
        connectionStatus: IntegrationConnectionStatus.CONNECTED,
        externalAccountId: realmId,
        externalAccountName: (companyInfo.CompanyName as string) || `QuickBooks Company (${realmId})`,
        credentialReference: {
          secretId: `sec_qb_${connection.id.slice(0, 8)}`,
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: `sha256:${crypto.createHash("sha256").update(tokens.accessToken).digest("hex").slice(0, 16)}`,
          secretPayload: JSON.stringify(tokens),
        },
        metadata: {
          realmId,
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
          message: err instanceof Error ? err.message : "Network error connecting to QuickBooks API.",
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
   * Health check ping against QuickBooks CompanyInfo endpoint.
   */
  public async testConnection(
    connection: IntegrationConnection,
    secretReference: IntegrationSecretReference
  ): Promise<TestResult> {
    const start = Date.now();
    const config = (connection.configJson as Record<string, unknown>) || {};
    const tokens = await this.getValidTokens(secretReference, connection);
    const realmId = tokens?.realmId || (config.realmId as string) || "mock_realm_id";

    if (!tokens?.accessToken) {
      return {
        success: false,
        latencyMs: 0,
        checkedAt: new Date(),
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "No valid OAuth2 tokens found for QuickBooks connection.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    try {
      const response = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
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
        const failure = this.translateQuickBooksError(response.status, errorBody);
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
          realmId,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
        failure: {
          code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
          message: err instanceof Error ? err.message : "QuickBooks health check failed.",
          isRetryable: true,
          httpStatusCode: 503,
        },
      };
    }
  }

  /**
   * Executes accounting synchronization actions:
   * - ACCOUNTING_INVOICE_SYNC
   * - ACCOUNTING_PAYMENT_SYNC
   * - ACCOUNTING_CUSTOMER_SYNC
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

    const realmId = tokens?.realmId || (config.realmId as string) || "mock_realm_id";

    if (!tokens?.accessToken) {
      return {
        success: false,
        capability: request.capability,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 401,
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "QuickBooks OAuth token is not configured or could not be refreshed.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    switch (request.capability) {
      case IntegrationCapability.ACCOUNTING_INVOICE_SYNC:
        return this.executeInvoiceSync(request, tokens.accessToken, realmId, start);
      case IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC:
        return this.executeCustomerSync(request, tokens.accessToken, realmId, start);
      case IntegrationCapability.ACCOUNTING_PAYMENT_SYNC:
        return this.executePaymentSync(request, tokens.accessToken, realmId, start);
      default:
        return {
          success: false,
          capability: request.capability,
          action: request.action,
          durationMs: Date.now() - start,
          failure: {
            code: IntegrationFailureCode.CAPABILITY_UNSUPPORTED,
            message: `Capability '${request.capability}' is not supported by QuickBooksAdapter.`,
            isRetryable: false,
            httpStatusCode: 400,
          },
        };
    }
  }

  /**
   * Ingests and normalizes QuickBooks change-data-capture webhooks.
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

    const config = (connection.configJson as Record<string, unknown>) || {};
    const verifierToken =
      (secretReference?.secretPayload as string) ||
      (config.webhookVerifierToken as string) ||
      process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN;

    const signature = headers.get("intuit-signature");
    if (verifierToken) {
      if (!signature) {
        return null;
      }
      const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
      const computed = crypto.createHmac("sha256", verifierToken).update(rawBody).digest("base64");
      try {
        const candBuf = Buffer.from(signature, "base64");
        const compBuf = Buffer.from(computed, "base64");
        if (candBuf.length !== compBuf.length || !crypto.timingSafeEqual(candBuf, compBuf)) {
          return null;
        }
      } catch {
        return null;
      }
    }

    const payloadObj = payload as Record<string, unknown>;
    const notifications = (payloadObj.eventNotifications as Array<Record<string, unknown>>) || [];
    const firstNotification = notifications[0] || {};
    const dataChangeEvent = (firstNotification.dataChangeEvent as Record<string, unknown>) || {};
    const entities = (dataChangeEvent.entities as Array<Record<string, unknown>>) || [];
    const entity = entities[0] || {};

    const entityName = (entity.name as string) || "Invoice";
    const entityId = (entity.id as string) || crypto.randomUUID();
    const operation = (entity.operation as string) || "Update";
    const eventType = `accounting.${entityName.toLowerCase()}.${operation.toLowerCase()}`;

    const rawPayloadHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    return {
      eventId: `evt_qb_${entityId}_${Date.now()}`,
      eventType,
      occurredAt: new Date(),
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      entityType: `QuickBooks${entityName}`,
      entityId,
      payload: {
        realmId: firstNotification.realmId,
        entityName,
        entityId,
        operation,
        rawEvent: payloadObj,
      },
      rawPayloadHash,
    };
  }

  // =========================================================================
  // Private Subsystem Execution Methods
  // =========================================================================

  private async executeInvoiceSync(
    request: IntegrationExecutionRequest,
    accessToken: string,
    realmId: string,
    start: number
  ): Promise<IntegrationExecutionResult> {
    const payload = (request.payload || {}) as Record<string, unknown>;

    if (!payload.lines && !payload.totalAmount) {
      return {
        success: false,
        capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: "Field 'lines' or 'totalAmount' is required to sync invoice to QuickBooks.",
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const lines = Array.isArray(payload.lines)
      ? payload.lines
      : [
          {
            Amount: Number(payload.totalAmount || 0),
            DetailType: "SalesItemLineDetail",
            SalesItemLineDetail: {
              ItemRef: { value: "1", name: "Services" },
            },
            Description: (payload.description as string) || "Field service work order",
          },
        ];

    const qbInvoicePayload = {
      DocNumber: payload.invoiceNumber || `INV-${Date.now()}`,
      TxnDate: payload.invoiceDate || new Date().toISOString().split("T")[0],
      DueDate: payload.dueDate || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      CustomerRef: payload.customerRef || { value: "1", name: "Walk-in Customer" },
      Line: lines,
    };

    try {
      const response = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/invoice`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "Aforden-Integration-Engine/1.0",
          },
          body: JSON.stringify(qbInvoicePayload),
        }
      );

      const durationMs = Date.now() - start;
      const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const failure = this.translateQuickBooksError(response.status, responseJson);
        return {
          success: false,
          capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
          action: request.action,
          durationMs,
          rawResponseStatus: response.status,
          failure,
        };
      }

      const invoiceData = (responseJson.Invoice as Record<string, unknown>) || responseJson;
      const qbInvoiceId = String(invoiceData.Id || invoiceData.id || "unknown");

      return {
        success: true,
        capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
        action: request.action,
        durationMs,
        rawResponseStatus: response.status,
        providerRequestId: qbInvoiceId,
        data: {
          quickbooksInvoiceId: qbInvoiceId,
          docNumber: invoiceData.DocNumber || qbInvoicePayload.DocNumber,
          totalAmount: invoiceData.TotalAmt,
          syncStatus: "SYNCED",
          idempotencyKey: request.idempotencyKey,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 504,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: err instanceof Error ? err.message : "Network error posting invoice to QuickBooks.",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
  }

  private async executeCustomerSync(
    request: IntegrationExecutionRequest,
    accessToken: string,
    realmId: string,
    start: number
  ): Promise<IntegrationExecutionResult> {
    const payload = (request.payload || {}) as Record<string, unknown>;

    const displayName =
      (payload.displayName as string) ||
      (payload.companyName as string) ||
      `${payload.givenName || ""} ${payload.familyName || ""}`.trim();

    if (!displayName) {
      return {
        success: false,
        capability: IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: "Field 'displayName' (or company/name) is required to sync customer to QuickBooks.",
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const qbCustomerPayload = {
      DisplayName: displayName,
      GivenName: payload.givenName,
      FamilyName: payload.familyName,
      CompanyName: payload.companyName,
      PrimaryEmailAddr: payload.email ? { Address: payload.email } : undefined,
      PrimaryPhone: payload.phone ? { FreeFormNumber: payload.phone } : undefined,
    };

    try {
      const response = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/customer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "Aforden-Integration-Engine/1.0",
          },
          body: JSON.stringify(qbCustomerPayload),
        }
      );

      const durationMs = Date.now() - start;
      const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const failure = this.translateQuickBooksError(response.status, responseJson);
        return {
          success: false,
          capability: IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC,
          action: request.action,
          durationMs,
          rawResponseStatus: response.status,
          failure,
        };
      }

      const customerData = (responseJson.Customer as Record<string, unknown>) || responseJson;
      const qbCustomerId = String(customerData.Id || customerData.id || "unknown");

      return {
        success: true,
        capability: IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC,
        action: request.action,
        durationMs,
        rawResponseStatus: response.status,
        providerRequestId: qbCustomerId,
        data: {
          quickbooksCustomerId: qbCustomerId,
          displayName: customerData.DisplayName || displayName,
          idempotencyKey: request.idempotencyKey,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        capability: IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 504,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: err instanceof Error ? err.message : "Network error posting customer to QuickBooks.",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
  }

  private async executePaymentSync(
    request: IntegrationExecutionRequest,
    accessToken: string,
    realmId: string,
    start: number
  ): Promise<IntegrationExecutionResult> {
    const payload = (request.payload || {}) as Record<string, unknown>;

    if (!payload.totalAmount) {
      return {
        success: false,
        capability: IntegrationCapability.ACCOUNTING_PAYMENT_SYNC,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: "Field 'totalAmount' is required to sync payment to QuickBooks.",
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const qbPaymentPayload = {
      TotalAmt: Number(payload.totalAmount),
      CustomerRef: payload.customerRef || { value: "1" },
      PaymentRefNum: payload.paymentRefNum || `PAY-${Date.now()}`,
      TxnDate: payload.paymentDate || new Date().toISOString().split("T")[0],
    };

    try {
      const response = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/payment`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "Aforden-Integration-Engine/1.0",
          },
          body: JSON.stringify(qbPaymentPayload),
        }
      );

      const durationMs = Date.now() - start;
      const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const failure = this.translateQuickBooksError(response.status, responseJson);
        return {
          success: false,
          capability: IntegrationCapability.ACCOUNTING_PAYMENT_SYNC,
          action: request.action,
          durationMs,
          rawResponseStatus: response.status,
          failure,
        };
      }

      const paymentData = (responseJson.Payment as Record<string, unknown>) || responseJson;
      const qbPaymentId = String(paymentData.Id || paymentData.id || "unknown");

      return {
        success: true,
        capability: IntegrationCapability.ACCOUNTING_PAYMENT_SYNC,
        action: request.action,
        durationMs,
        rawResponseStatus: response.status,
        providerRequestId: qbPaymentId,
        data: {
          quickbooksPaymentId: qbPaymentId,
          totalAmount: paymentData.TotalAmt || qbPaymentPayload.TotalAmt,
          idempotencyKey: request.idempotencyKey,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        capability: IntegrationCapability.ACCOUNTING_PAYMENT_SYNC,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 504,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: err instanceof Error ? err.message : "Network error posting payment to QuickBooks.",
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
    const clientId = (config.clientId as string) || process.env.QUICKBOOKS_CLIENT_ID || "mock_qb_client_id";
    const clientSecret = (config.clientSecret as string) || process.env.QUICKBOOKS_CLIENT_SECRET || "mock_qb_client_secret";

    return refreshOAuth2TokenWithMutex({
      connectionId: connection.id,
      tokenEndpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      clientId,
      clientSecret,
      currentTokens: rawTokens,
      useBasicAuth: true,
    });
  }

  /**
   * Exhaustively translates QuickBooks Intuit Fault errors to standardized IntegrationFailure.
   */
  public translateQuickBooksError(
    statusCode: number,
    errorBody: Record<string, unknown>
  ): IntegrationFailure {
    const fault = (errorBody.Fault as Record<string, unknown>) || {};
    const errors = (fault.Error as Array<Record<string, unknown>>) || [];
    const firstError = errors[0] || {};

    const rawCode = String(firstError.code || statusCode);
    const rawMessage = (firstError.Message as string) || (firstError.Detail as string) || `QuickBooks error HTTP ${statusCode}`;

    // QuickBooks specific error codes
    switch (rawCode) {
      case "3200": // Token expired / invalid
      case "3100": // Authentication failure
        return {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: 401,
          providerRawCode: rawCode,
          providerRawMessage: rawMessage,
        };
      case "6000": // Validation error
      case "2030": // Duplicate document number
      case "2050": // Entity not found or invalid reference
      case "610":  // Object Not Found
        return {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: 400,
          providerRawCode: rawCode,
          providerRawMessage: rawMessage,
        };
      case "429": // Rate limited
        return {
          code: IntegrationFailureCode.RATE_LIMITED,
          message: rawMessage,
          isRetryable: true,
          retryAfterSeconds: 30,
          httpStatusCode: 429,
          providerRawCode: rawCode,
          providerRawMessage: rawMessage,
        };
      case "500":
      case "503":
        return {
          code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
          message: rawMessage,
          isRetryable: true,
          httpStatusCode: 503,
          providerRawCode: rawCode,
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
          providerRawCode: rawCode,
          providerRawMessage: rawMessage,
        };
      case 400:
      case 422:
        return {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: statusCode,
          providerRawCode: rawCode,
          providerRawMessage: rawMessage,
        };
      case 404:
        return {
          code: IntegrationFailureCode.RESOURCE_NOT_FOUND,
          message: rawMessage,
          isRetryable: false,
          httpStatusCode: 404,
          providerRawCode: rawCode,
          providerRawMessage: rawMessage,
        };
      case 429:
        return {
          code: IntegrationFailureCode.RATE_LIMITED,
          message: rawMessage,
          isRetryable: true,
          retryAfterSeconds: 30,
          httpStatusCode: 429,
          providerRawCode: rawCode,
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
          providerRawCode: rawCode,
          providerRawMessage: rawMessage,
        };
      case 504:
        return {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: rawMessage,
          isRetryable: true,
          httpStatusCode: 504,
          providerRawCode: rawCode,
          providerRawMessage: rawMessage,
        };
      default:
        return {
          code: statusCode >= 500 ? IntegrationFailureCode.SERVICE_UNAVAILABLE : IntegrationFailureCode.BAD_REQUEST,
          message: rawMessage,
          isRetryable: statusCode >= 500,
          httpStatusCode: statusCode,
          providerRawCode: rawCode,
          providerRawMessage: rawMessage,
        };
    }
  }
}
