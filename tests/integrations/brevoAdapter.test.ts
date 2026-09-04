/**
 * Phase 1.23.3 — BrevoAdapter Contract, Execution, Error Translation & Webhook Tests
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BrevoAdapter } from "@/lib/integrations/adapters/brevoAdapter";
import {
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationFailureCode,
  type IntegrationConnection,
  type IntegrationSecretReference,
  type IntegrationExecutionRequest,
} from "@/lib/integrations/adapters/types";
import { AdapterRegistry } from "@/lib/integrations/adapters/adapterRegistry";
import { SEED_INTEGRATIONS } from "@/lib/integrations/seed/integrationSeed";

describe("Phase 1.23.3 — BrevoAdapter Unit & Contract Tests", () => {
  let adapter: BrevoAdapter;
  let mockConnection: IntegrationConnection;
  let mockSecretRef: IntegrationSecretReference;

  beforeEach(() => {
    adapter = new BrevoAdapter();
    mockConnection = {
      id: "conn_brevo_test_123",
      workspaceId: "ws_test_456",
      integrationId: "brevo",
      connectionKey: "primary",
      status: IntegrationConnectionStatus.CONNECTED,
      configJson: {
        fromEmail: "Aforden <notifications@aforden.com>",
        webhookSigningSecret: "brevo_wh_sec_xyz789",
      },
      metadataJson: null,
      externalAccountId: null,
      externalAccountName: null,
      lastTestedAt: null,
      lastErrorJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockSecretRef = {
      secretId: "sec_brevo_123",
      version: 1,
      keyVaultProvider: "LOCAL_ENCRYPTED_DB",
      algorithm: "AES_256_GCM",
      fingerprint: "sha256:abc12345",
      secretPayload: "xkeysib-live-mock-api-key-xyz",
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Identity & Capability Registration", () => {
    it("should report correct identity metadata and capabilities", () => {
      expect(adapter.integrationId).toBe("brevo");
      expect(adapter.displayName).toBe("Brevo");
      expect(adapter.version).toBe("1.0.0");
      expect(adapter.getCapabilities()).toEqual([
        IntegrationCapability.EMAIL_SEND,
        IntegrationCapability.WEBHOOK_RECEIVE,
      ]);
    });

    it("should register successfully and pass catalog subset validation against SEED_INTEGRATIONS", () => {
      AdapterRegistry.clearAdapters();
      AdapterRegistry.registerAdapter(adapter);
      expect(AdapterRegistry.hasAdapter("brevo")).toBe(true);

      // Verify that [EMAIL_SEND, WEBHOOK_RECEIVE] matches the catalog definition in SEED_INTEGRATIONS
      expect(() =>
        AdapterRegistry.validateAdapterCatalogConsistency(SEED_INTEGRATIONS)
      ).not.toThrow();
    });
  });

  describe("2. connect() Handshake & Webhook Provisioning", () => {
    it("should fail connect() when API key is missing", async () => {
      const connWithoutKey = { ...mockConnection, configJson: {} };
      const prevEnv = process.env.BREVO_API_KEY;
      delete process.env.BREVO_API_KEY;

      try {
        const result = await adapter.connect(connWithoutKey);
        expect(result.success).toBe(false);
        expect(result.connectionStatus).toBe(IntegrationConnectionStatus.ERROR);
        expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
        expect(result.failure?.httpStatusCode).toBe(401);
      } finally {
        if (prevEnv) process.env.BREVO_API_KEY = prevEnv;
      }
    });

    it("should return CONNECTED on valid API key ping and provision webhook subscription", async () => {
      const fetchSpy = vi.spyOn(global, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ email: "admin@aforden.com", plan: [{ type: "free" }] }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ id: 101 }),
        } as unknown as Response);

      const result = await adapter.connect(mockConnection, { apiKey: "xkeysib-live-valid" });
      expect(result.success).toBe(true);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.CONNECTED);
      expect(result.externalAccountId).toBeDefined();
      expect(result.externalAccountName).toBe("admin@aforden.com");
      expect(result.metadata?.webhookId).toBe(101);

      // Verify credentials contain encrypted payload with apiKey, webhookSecret, and webhookId
      const payload = JSON.parse(result.credentialReference.secretPayload as string);
      expect(payload.apiKey).toBe("xkeysib-live-valid");
      expect(payload.webhookSecret).toMatch(/^whsec_brevo_/);
      expect(payload.webhookId).toBe(101);

      // Verify account ping
      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        "https://api.brevo.com/v3/account",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "api-key": "xkeysib-live-valid",
          }),
        })
      );

      // Verify webhook creation POST /v3/webhooks
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        "https://api.brevo.com/v3/webhooks",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "api-key": "xkeysib-live-valid",
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining('"type":"transactional"'),
        })
      );
    });

    it("should fail connect() when Brevo webhook creation fails", async () => {
      vi.spyOn(global, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ email: "admin@aforden.com" }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ code: "invalid_parameter", message: "Webhook URL already exists" }),
        } as unknown as Response);

      const result = await adapter.connect(mockConnection, { apiKey: "xkeysib-live-valid" });
      expect(result.success).toBe(false);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.ERROR);
      expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
      expect(result.failure?.message).toContain("Brevo webhook provisioning failed");
    });

    it("should skip webhook registration if skipWebhookRegistration flag is set", async () => {
      const connWithSkip = {
        ...mockConnection,
        configJson: { skipWebhookRegistration: true },
      };

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ email: "admin@aforden.com" }),
      } as unknown as Response);

      const result = await adapter.connect(connWithSkip, { apiKey: "xkeysib-live-valid" });
      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should translate 401 error response on account ping to AUTHENTICATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          code: "unauthorized",
          message: "Key not found",
        }),
      } as unknown as Response);

      const result = await adapter.connect(mockConnection, { apiKey: "xkeysib-invalid-key" });
      expect(result.success).toBe(false);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.ERROR);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.providerRawMessage).toBe("Key not found");
    });

    it("should translate network connection failure to NETWORK_TIMEOUT", async () => {
      vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("connect ETIMEDOUT 104.18.25.10:443"));

      const result = await adapter.connect(mockConnection, { apiKey: "xkeysib-timeout" });
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.NETWORK_TIMEOUT);
      expect(result.failure?.isRetryable).toBe(true);
    });
  });

  describe("3. testConnection() Health Check", () => {
    it("should return success when health check returns 200", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ email: "admin@aforden.com" }),
      } as unknown as Response);

      const result = await adapter.testConnection(mockConnection, mockSecretRef);
      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.checkedAt).toBeInstanceOf(Date);
    });

    it("should return AUTHENTICATION_FAILED on 401 response", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: "Unauthorized API key", code: "unauthorized" }),
      } as unknown as Response);

      const result = await adapter.testConnection(mockConnection, mockSecretRef);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.httpStatusCode).toBe(401);
    });

    it("should return SERVICE_UNAVAILABLE on 503 response", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ message: "Brevo service under maintenance" }),
      } as unknown as Response);

      const result = await adapter.testConnection(mockConnection, mockSecretRef);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);
      expect(result.failure?.isRetryable).toBe(true);
    });
  });

  describe("4. execute() Outbound Email Dispatch & Error Translations", () => {
    const baseRequest: IntegrationExecutionRequest = {
      workspaceId: "ws_test_456",
      connectionId: "conn_brevo_test_123",
      capability: IntegrationCapability.EMAIL_SEND,
      action: "send",
      payload: {
        to: "customer@example.com",
        subject: "Your Work Order #1042 has been scheduled",
        html: "<p>Technician arriving at 10:00 AM</p>",
      },
      idempotencyKey: "uuidv5-brevo-test-key-1234",
      correlationId: "corr-1234-5678",
      secretReference: {
        secretId: "sec_brevo_123",
        version: 1,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        fingerprint: "sha256:abc12345",
        secretPayload: "xkeysib-live-api-key-valid",
      },
      connectionConfig: {
        fromEmail: "Aforden <notifications@aforden.com>",
      },
    };

    it("should reject unsupported capability with CAPABILITY_UNSUPPORTED", async () => {
      const result = await adapter.execute({
        ...baseRequest,
        capability: IntegrationCapability.SMS_SEND,
      });

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.CAPABILITY_UNSUPPORTED);
      expect(result.failure?.isRetryable).toBe(false);
    });

    it("should fail validation on missing or invalid email fields", async () => {
      // Missing 'to'
      const resMissingTo = await adapter.execute({
        ...baseRequest,
        payload: { subject: "Test", html: "Hello" },
      });
      expect(resMissingTo.success).toBe(false);
      expect(resMissingTo.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);

      // Invalid 'to' email
      const resInvalidEmail = await adapter.execute({
        ...baseRequest,
        payload: { to: "not-an-email", subject: "Test", html: "Hello" },
      });
      expect(resInvalidEmail.success).toBe(false);
      expect(resInvalidEmail.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);

      // Missing 'subject'
      const resMissingSubject = await adapter.execute({
        ...baseRequest,
        payload: { to: "user@example.com", html: "Hello" },
      });
      expect(resMissingSubject.success).toBe(false);
      expect(resMissingSubject.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);

      // Missing body / html
      const resMissingBody = await adapter.execute({
        ...baseRequest,
        payload: { to: "user@example.com", subject: "Test" },
      });
      expect(resMissingBody.success).toBe(false);
      expect(resMissingBody.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
    });

    it("should successfully send email and return normalized result", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ messageId: "<20260904.brevo.test@smtp-relay.brevo.com>" }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.EMAIL_SEND);
      expect(result.providerRequestId).toBe("<20260904.brevo.test@smtp-relay.brevo.com>");
      expect(result.data?.messageId).toBe("<20260904.brevo.test@smtp-relay.brevo.com>");
      expect(result.data?.to).toBe("customer@example.com");

      // Verify request headers and body
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.brevo.com/v3/smtp/email",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "api-key": "xkeysib-live-api-key-valid",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            sender: { name: "Aforden", email: "notifications@aforden.com" },
            to: [{ email: "customer@example.com" }],
            subject: "Your Work Order #1042 has been scheduled",
            htmlContent: "<p>Technician arriving at 10:00 AM</p>",
          }),
        })
      );
    });

    it("should translate 400 Bad Request to PAYLOAD_VALIDATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          code: "invalid_parameter",
          message: "Invalid email address format.",
        }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.httpStatusCode).toBe(400);
    });

    it("should translate 429 Rate Limited and extract Retry-After header", async () => {
      const mockHeaders = new Headers();
      mockHeaders.set("retry-after", "20");

      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: mockHeaders,
        json: async () => ({
          code: "too_many_requests",
          message: "Rate limit exceeded. Please retry later.",
        }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.RATE_LIMITED);
      expect(result.failure?.isRetryable).toBe(true);
      expect(result.failure?.retryAfterSeconds).toBe(20);
    });

    it("should translate 500/503 errors to SERVICE_UNAVAILABLE (retryable)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          code: "internal_server_error",
          message: "Brevo mail cluster temporary outage",
        }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);
      expect(result.failure?.isRetryable).toBe(true);
    });

    it("should translate network timeout exception to NETWORK_TIMEOUT", async () => {
      vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("socket hang up"));

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.NETWORK_TIMEOUT);
      expect(result.failure?.isRetryable).toBe(true);
    });
  });

  describe("5. handleWebhook() Custom Header Auth & Event Normalization", () => {
    const webhookSecret = "whsec_brevo_test_super_secret_token_123456789";
    let webhookSecretRef: IntegrationSecretReference;

    beforeEach(() => {
      webhookSecretRef = {
        secretId: "sec_brevo_123",
        version: 1,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        fingerprint: "sha256:abc12345",
        secretPayload: JSON.stringify({
          apiKey: "xkeysib-mock",
          webhookSecret,
          webhookId: 101,
        }),
      };
    });

    it("should accept valid X-Aforden-Webhook-Secret and normalize 'delivered' event", async () => {
      const payload = {
        event: "delivered",
        email: "customer@example.com",
        "message-id": "<msg_brevo_001@smtp-relay.brevo.com>",
        date: "2026-09-04 14:30:00",
        subject: "Work Order Scheduled",
        tag: "work_order",
      };

      const headers = new Headers();
      headers.set("x-aforden-webhook-secret", webhookSecret);

      const event = await adapter.handleWebhook(payload, headers, webhookSecretRef, mockConnection);

      expect(event).not.toBeNull();
      expect(event?.eventType).toBe("email.delivered");
      expect(event?.entityType).toBe("EmailMessage");
      expect(event?.entityId).toBe("<msg_brevo_001@smtp-relay.brevo.com>");
      expect(event?.workspaceId).toBe(mockConnection.workspaceId);
      expect(event?.connectionId).toBe(mockConnection.id);
      expect(event?.payload.status).toBe("delivered");
      expect(event?.payload.email).toBe("customer@example.com");
      expect(event?.payload.subject).toBe("Work Order Scheduled");
      expect(event?.eventId).toMatch(/^evt_brevo_[a-f0-9]{32}$/);
    });

    it("should reject webhook request when custom secret header is missing", async () => {
      const payload = {
        event: "delivered",
        email: "customer@example.com",
        "message-id": "<msg_brevo_002@smtp-relay.brevo.com>",
      };

      const headers = new Headers(); // No secret header

      const event = await adapter.handleWebhook(payload, headers, webhookSecretRef, mockConnection);
      expect(event).toBeNull();
    });

    it("should reject webhook request when custom secret is invalid", async () => {
      const payload = {
        event: "delivered",
        email: "customer@example.com",
        "message-id": "<msg_brevo_003@smtp-relay.brevo.com>",
      };

      const headers = new Headers();
      headers.set("x-aforden-webhook-secret", "invalid_secret_wrong_token");

      const event = await adapter.handleWebhook(payload, headers, webhookSecretRef, mockConnection);
      expect(event).toBeNull();
    });

    it("should normalize all Brevo transactional email event types", async () => {
      const testCases: Array<{ raw: string; expected: string }> = [
        { raw: "delivered", expected: "email.delivered" },
        { raw: "hardBounce", expected: "email.hard_bounce" },
        { raw: "softBounce", expected: "email.soft_bounce" },
        { raw: "blocked", expected: "email.blocked" },
        { raw: "spam", expected: "email.spam" },
        { raw: "opened", expected: "email.opened" },
        { raw: "uniqueOpened", expected: "email.opened" },
        { raw: "click", expected: "email.clicked" },
        { raw: "unsubscribed", expected: "email.unsubscribed" },
        { raw: "request", expected: "email.sent" },
      ];

      for (const tc of testCases) {
        const payload = {
          event: tc.raw,
          email: "customer@example.com",
          "message-id": `<msg_${tc.raw}@smtp-relay.brevo.com>`,
          date: "2026-09-04 12:00:00",
        };
        const headers = new Headers({ "x-aforden-webhook-secret": webhookSecret });
        const event = await adapter.handleWebhook(payload, headers, webhookSecretRef, mockConnection);
        expect(event).not.toBeNull();
        expect(event?.eventType).toBe(tc.expected);
        expect(event?.payload.status).toBe(tc.expected.replace("email.", ""));
      }
    });

    it("should generate deterministic synthetic idempotency key for replay detection", async () => {
      const payload = {
        event: "delivered",
        email: "customer@example.com",
        "message-id": "<msg_dedup_001@smtp-relay.brevo.com>",
        date: "2026-09-04 12:00:00",
      };
      const headers = new Headers({ "x-aforden-webhook-secret": webhookSecret });

      // First call
      const event1 = await adapter.handleWebhook(payload, headers, webhookSecretRef, mockConnection);
      // Duplicate call
      const event2 = await adapter.handleWebhook(payload, headers, webhookSecretRef, mockConnection);

      expect(event1?.eventId).toBeDefined();
      expect(event1?.eventId).toBe(event2?.eventId);

      // Different event for same message should produce distinct eventId
      const payloadOpened = { ...payload, event: "opened" };
      const eventOpened = await adapter.handleWebhook(payloadOpened, headers, webhookSecretRef, mockConnection);
      expect(eventOpened?.eventId).not.toBe(event1?.eventId);
    });

    it("should accept fallback custom header names (x-webhook-secret, x-brevo-webhook-secret)", async () => {
      const payload = {
        event: "opened",
        email: "customer@example.com",
        "message-id": "<msg_fallback_header@smtp-relay.brevo.com>",
      };

      const headers1 = new Headers({ "x-webhook-secret": webhookSecret });
      const res1 = await adapter.handleWebhook(payload, headers1, webhookSecretRef, mockConnection);
      expect(res1).not.toBeNull();
      expect(res1?.eventType).toBe("email.opened");

      const headers2 = new Headers({ "x-brevo-webhook-secret": webhookSecret });
      const res2 = await adapter.handleWebhook(payload, headers2, webhookSecretRef, mockConnection);
      expect(res2).not.toBeNull();
      expect(res2?.eventType).toBe("email.opened");
    });
  });
});
