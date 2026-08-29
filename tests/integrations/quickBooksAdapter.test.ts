/**
 * Phase 1.17.8 — QuickBooksAdapter Contract, OAuth2 Mutex, Accounting Sync & Webhook Tests
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { QuickBooksAdapter } from "@/lib/integrations/adapters/quickBooksAdapter";
import {
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationFailureCode,
  type IntegrationConnection,
  type IntegrationSecretReference,
  type IntegrationExecutionRequest,
} from "@/lib/integrations/adapters/types";
import { SEED_INTEGRATIONS } from "@/lib/integrations/seed/integrationSeed";
import { AdapterRegistry } from "@/lib/integrations/adapters/adapterRegistry";
import { clearInFlightOAuth2Refreshes } from "@/lib/integrations/adapters/oauth2Helper";

describe("Phase 1.17.8 — QuickBooksAdapter Unit & Contract Tests", () => {
  let adapter: QuickBooksAdapter;
  let mockConnection: IntegrationConnection;
  let mockSecretRef: IntegrationSecretReference;

  const sampleRealmId = "9130352726354821";
  const sampleAccessToken = "ey_mock_qb_access_token_12345678";
  const sampleRefreshToken = "rt_mock_qb_refresh_token_87654321";

  beforeEach(() => {
    clearInFlightOAuth2Refreshes();
    adapter = new QuickBooksAdapter();
    mockConnection = {
      id: "conn_qb_test_123",
      workspaceId: "ws_test_456",
      integrationId: "quickbooks_online",
      connectionKey: "primary",
      status: IntegrationConnectionStatus.CONNECTED,
      configJson: {
        realmId: sampleRealmId,
        clientId: "qb_client_id_test",
        clientSecret: "qb_client_secret_test",
      },
      metadataJson: null,
      externalAccountId: sampleRealmId,
      externalAccountName: "ACME HVAC LLC",
      lastTestedAt: null,
      lastErrorJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockSecretRef = {
      secretId: "sec_qb_123",
      version: 1,
      keyVaultProvider: "LOCAL_ENCRYPTED_DB",
      algorithm: "AES_256_GCM",
      fingerprint: "sha256:qb12345",
      secretPayload: JSON.stringify({
        accessToken: sampleAccessToken,
        refreshToken: sampleRefreshToken,
        realmId: sampleRealmId,
        expiresAt: Date.now() + 3600 * 1000,
        tokenType: "Bearer",
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearInFlightOAuth2Refreshes();
  });

  describe("1. Identity & Exclusive Capability Registration", () => {
    it("should report correct identity metadata and all 3 accounting capabilities", () => {
      expect(adapter.integrationId).toBe("quickbooks_online");
      expect(adapter.displayName).toBe("QuickBooks Online");
      expect(adapter.version).toBe("1.0.0");
      expect(adapter.getCapabilities()).toEqual([
        IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
        IntegrationCapability.ACCOUNTING_PAYMENT_SYNC,
        IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC,
      ]);
    });

    it("should register successfully and pass catalog consistency checks", () => {
      AdapterRegistry.clearAdapters();
      AdapterRegistry.registerAdapter(adapter);
      expect(AdapterRegistry.hasAdapter("quickbooks_online")).toBe(true);

      // Verify declared capabilities form a valid subset of catalog definition
      expect(() =>
        AdapterRegistry.validateAdapterCatalogConsistency(SEED_INTEGRATIONS)
      ).not.toThrow();
    });
  });

  describe("2. OAuth2 In-Flight Concurrency Mutex & Token Refresh", () => {
    it("should refresh expired token using refresh_token grant", async () => {
      const expiredSecretRef: IntegrationSecretReference = {
        ...mockSecretRef,
        secretPayload: JSON.stringify({
          accessToken: "expired_access_token",
          refreshToken: sampleRefreshToken,
          realmId: sampleRealmId,
          expiresAt: Date.now() - 5000, // Expired
        }),
      };

      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        if (String(url).includes("tokens/bearer")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: "new_rotated_access_token",
              refresh_token: "new_rotated_refresh_token",
              expires_in: 3600,
              token_type: "Bearer",
            }),
          } as unknown as Response;
        }
        if (String(url).includes("companyinfo")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ CompanyInfo: { CompanyName: "ACME HVAC LLC" } }),
          } as unknown as Response;
        }
        return { ok: false, status: 404 } as unknown as Response;
      });

      const result = await adapter.testConnection(mockConnection, expiredSecretRef);
      expect(result.success).toBe(true);

      // Verify token refresh was requested with Basic auth and refresh_token
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Basic "),
          }),
        })
      );
    });

    it("should deduplicate concurrent refresh requests using in-flight mutex (single-flight execution)", async () => {
      const expiredSecretRef: IntegrationSecretReference = {
        ...mockSecretRef,
        secretPayload: JSON.stringify({
          accessToken: "expired_token_concurrent",
          refreshToken: sampleRefreshToken,
          realmId: sampleRealmId,
          expiresAt: Date.now() - 10000,
        }),
      };

      let tokenEndpointCallCount = 0;

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        if (String(url).includes("tokens/bearer")) {
          tokenEndpointCallCount++;
          // Add artificial delay to guarantee concurrency overlap
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: "new_access_token_mutex",
              refresh_token: "new_refresh_token_mutex",
              expires_in: 3600,
            }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ CompanyInfo: { CompanyName: "ACME HVAC LLC" } }),
        } as unknown as Response;
      });

      // Fire 2 concurrent testConnection operations simultaneously
      const [res1, res2] = await Promise.all([
        adapter.testConnection(mockConnection, expiredSecretRef),
        adapter.testConnection(mockConnection, expiredSecretRef),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      // Mutex guarantee: Exactly 1 HTTP POST to the token endpoint occurred
      expect(tokenEndpointCallCount).toBe(1);
    });
  });

  describe("3. connect() Handshake", () => {
    it("should exchange authorization code for OAuth tokens and verify company info", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        if (String(url).includes("tokens/bearer")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: "auth_code_access_token",
              refresh_token: "auth_code_refresh_token",
              expires_in: 3600,
            }),
          } as unknown as Response;
        }
        if (String(url).includes("companyinfo")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              CompanyInfo: {
                CompanyName: "Field Operations Pro Services",
              },
            }),
          } as unknown as Response;
        }
        return { ok: false, status: 404 } as unknown as Response;
      });

      const result = await adapter.connect(mockConnection, {
        code: "auth_code_12345",
        redirectUri: "https://app.aforden.com/api/integrations/oauth/callback",
        realmId: sampleRealmId,
      });

      expect(result.success).toBe(true);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.CONNECTED);
      expect(result.externalAccountId).toBe(sampleRealmId);
      expect(result.externalAccountName).toBe("Field Operations Pro Services");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("should translate OAuth code exchange failure to AUTHENTICATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid_grant", error_description: "Code has expired" }),
      } as unknown as Response);

      const result = await adapter.connect(mockConnection, { code: "expired_code" });
      expect(result.success).toBe(false);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.ERROR);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
    });
  });

  describe("4. execute() Accounting Synchronization & Fault Translations", () => {
    const getBaseRequest = (): IntegrationExecutionRequest => ({
      workspaceId: "ws_test_456",
      connectionId: "conn_qb_test_123",
      capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
      action: "sync_invoice",
      payload: {
        invoiceNumber: "INV-2026-0042",
        invoiceDate: "2026-08-29",
        dueDate: "2026-09-28",
        customerRef: { value: "65", name: "Metro Residential Properties" },
        totalAmount: 450.0,
        lines: [
          {
            Amount: 450.0,
            DetailType: "SalesItemLineDetail",
            SalesItemLineDetail: { ItemRef: { value: "1", name: "HVAC Repair" } },
            Description: "Compressor diagnostic and refrigerant recharge",
          },
        ],
      },
      idempotencyKey: "uuidv5-qb-invoice-test-key",
      correlationId: "corr-qb-1234",
      secretReference: mockSecretRef,
      connectionConfig: {
        realmId: sampleRealmId,
      },
    });

    it("should successfully sync invoice to QuickBooks", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          Invoice: {
            Id: "142",
            DocNumber: "INV-2026-0042",
            TotalAmt: 450.0,
            Balance: 450.0,
          },
        }),
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.ACCOUNTING_INVOICE_SYNC);
      expect(result.data?.quickbooksInvoiceId).toBe("142");
      expect(result.data?.docNumber).toBe("INV-2026-0042");
      expect(result.data?.syncStatus).toBe("SYNCED");

      expect(fetchSpy).toHaveBeenCalledWith(
        `https://quickbooks.api.intuit.com/v3/company/${sampleRealmId}/invoice`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${sampleAccessToken}`,
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should successfully sync customer to QuickBooks", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          Customer: {
            Id: "89",
            DisplayName: "Acme Industrial Facilities",
          },
        }),
      } as unknown as Response);

      const result = await adapter.execute({
        ...getBaseRequest(),
        capability: IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC,
        action: "sync_customer",
        payload: {
          displayName: "Acme Industrial Facilities",
          email: "billing@acmefacilities.com",
          phone: "555-0199",
        },
      });

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC);
      expect(result.data?.quickbooksCustomerId).toBe("89");
      expect(result.data?.displayName).toBe("Acme Industrial Facilities");
    });

    it("should successfully sync payment to QuickBooks", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          Payment: {
            Id: "305",
            TotalAmt: 450.0,
          },
        }),
      } as unknown as Response);

      const result = await adapter.execute({
        ...getBaseRequest(),
        capability: IntegrationCapability.ACCOUNTING_PAYMENT_SYNC,
        action: "sync_payment",
        payload: {
          totalAmount: 450.0,
          customerRef: { value: "65" },
          paymentRefNum: "PAY-1002",
        },
      });

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.ACCOUNTING_PAYMENT_SYNC);
      expect(result.data?.quickbooksPaymentId).toBe("305");
      expect(result.data?.totalAmount).toBe(450.0);
    });

    it("should translate QuickBooks Intuit Fault error 3200 to AUTHENTICATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          Fault: {
            Error: [
              {
                Message: "message=AuthenticationFailed; errorCode=003200; statusCode=401",
                Detail: "Token expired or unauthorized",
                code: "3200",
              },
            ],
            type: "AUTHENTICATION",
          },
        }),
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.providerRawCode).toBe("3200");
    });

    it("should translate QuickBooks Fault error 6000 / 2030 (duplicate doc number) to PAYLOAD_VALIDATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          Fault: {
            Error: [
              {
                Message: "Duplicate Document Number Error",
                Detail: "DocNumber 'INV-2026-0042' is already in use.",
                code: "2030",
              },
            ],
          },
        }),
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.providerRawCode).toBe("2030");
    });

    it("should translate 429 Rate Limited response to RATE_LIMITED (retryable)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          Fault: {
            Error: [{ Message: "Throttle Exceeded", code: "429" }],
          },
        }),
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.RATE_LIMITED);
      expect(result.failure?.isRetryable).toBe(true);
      expect(result.failure?.retryAfterSeconds).toBe(30);
    });

    it("should translate 500/503 errors to SERVICE_UNAVAILABLE (retryable)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          Fault: {
            Error: [{ Message: "QuickBooks Service Temporarily Unavailable", code: "503" }],
          },
        }),
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);
      expect(result.failure?.isRetryable).toBe(true);
    });
  });

  describe("5. handleWebhook() Intuit Signature Verification & Event Normalization", () => {
    const verifierToken = "qb_webhook_verifier_token_secret_123";

    it("should verify valid intuit-signature HMAC-SHA256 signature and normalize CDC event", async () => {
      const payload = {
        eventNotifications: [
          {
            realmId: sampleRealmId,
            dataChangeEvent: {
              entities: [
                {
                  name: "Invoice",
                  id: "142",
                  operation: "Update",
                  lastUpdated: "2026-08-29T10:30:00.000Z",
                },
              ],
            },
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto
        .createHmac("sha256", verifierToken)
        .update(rawBody)
        .digest("base64");

      const headers = new Headers();
      headers.set("intuit-signature", signature);

      const secretRef: IntegrationSecretReference = {
        ...mockSecretRef,
        secretPayload: verifierToken,
      };

      const event = await adapter.handleWebhook(payload, headers, secretRef, mockConnection);

      expect(event).not.toBeNull();
      expect(event?.eventType).toBe("accounting.invoice.update");
      expect(event?.entityType).toBe("QuickBooksInvoice");
      expect(event?.entityId).toBe("142");
      expect(event?.workspaceId).toBe(mockConnection.workspaceId);
      expect(event?.connectionId).toBe(mockConnection.id);
      expect(event?.payload.realmId).toBe(sampleRealmId);
      expect(event?.payload.operation).toBe("Update");
    });

    it("should reject tampered intuit-signature", async () => {
      const payload = { eventNotifications: [] };
      const headers = new Headers();
      headers.set("intuit-signature", "tampered_signature_base64==");

      const secretRef: IntegrationSecretReference = {
        ...mockSecretRef,
        secretPayload: verifierToken,
      };

      const event = await adapter.handleWebhook(payload, headers, secretRef, mockConnection);
      expect(event).toBeNull();
    });
  });
});
