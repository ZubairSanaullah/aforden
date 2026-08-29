/**
 * Phase 1.17.7 — ResendAdapter Contract, Execution, Error Translation & Webhook Tests
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  ResendAdapter,
  verifySvixSignature,
} from "@/lib/integrations/adapters/resendAdapter";
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

describe("Phase 1.17.7 — ResendAdapter Unit & Contract Tests", () => {
  let adapter: ResendAdapter;
  let mockConnection: IntegrationConnection;
  let mockSecretRef: IntegrationSecretReference;

  beforeEach(() => {
    adapter = new ResendAdapter();
    mockConnection = {
      id: "conn_resend_test_123",
      workspaceId: "ws_test_456",
      integrationId: "resend",
      connectionKey: "primary",
      status: IntegrationConnectionStatus.CONNECTED,
      configJson: {
        fromEmail: "Aforden <notifications@aforden.com>",
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
      secretId: "sec_resend_123",
      version: 1,
      keyVaultProvider: "LOCAL_ENCRYPTED_DB",
      algorithm: "AES_256_GCM",
      fingerprint: "sha256:abc12345",
      secretPayload: "re_test_mock_api_key_xyz",
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Identity & Capability Registration", () => {
    it("should report correct identity metadata and capabilities", () => {
      expect(adapter.integrationId).toBe("resend");
      expect(adapter.displayName).toBe("Resend");
      expect(adapter.version).toBe("1.0.0");
      expect(adapter.getCapabilities()).toEqual([IntegrationCapability.EMAIL_SEND]);
    });

    it("should register successfully and pass catalog subset validation", () => {
      AdapterRegistry.clearAdapters();
      AdapterRegistry.registerAdapter(adapter);
      expect(AdapterRegistry.hasAdapter("resend")).toBe(true);

      // Verify that [EMAIL_SEND] is a valid subset of catalog entry [EMAIL_SEND, WEBHOOK_RECEIVE]
      expect(() =>
        AdapterRegistry.validateAdapterCatalogConsistency(SEED_INTEGRATIONS)
      ).not.toThrow();
    });
  });

  describe("2. connect() Handshake", () => {
    it("should fail connect() when API key is missing", async () => {
      const connWithoutKey = { ...mockConnection, configJson: {} };
      const prevEnv = process.env.RESEND_API_KEY;
      delete process.env.RESEND_API_KEY;

      try {
        const result = await adapter.connect(connWithoutKey);
        expect(result.success).toBe(false);
        expect(result.connectionStatus).toBe(IntegrationConnectionStatus.ERROR);
        expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
        expect(result.failure?.httpStatusCode).toBe(401);
      } finally {
        if (prevEnv) process.env.RESEND_API_KEY = prevEnv;
      }
    });

    it("should return CONNECTED on valid API key ping", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "key_1", name: "Production Key" }] }),
      } as unknown as Response);

      const result = await adapter.connect(mockConnection, { apiKey: "re_live_valid_key" });
      expect(result.success).toBe(true);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.CONNECTED);
      expect(result.externalAccountId).toBeDefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.resend.com/api-keys",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer re_live_valid_key",
          }),
        })
      );
    });

    it("should translate 401 error response to AUTHENTICATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          statusCode: 401,
          name: "authentication_error",
          message: "API key is invalid",
        }),
      } as unknown as Response);

      const result = await adapter.connect(mockConnection, { apiKey: "re_invalid_key" });
      expect(result.success).toBe(false);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.ERROR);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.providerRawMessage).toBe("API key is invalid");
    });

    it("should translate network connection failure to NETWORK_TIMEOUT", async () => {
      vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("connect ETIMEDOUT 104.26.15.228:443"));

      const result = await adapter.connect(mockConnection, { apiKey: "re_timeout_key" });
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
        json: async () => ({}),
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
        json: async () => ({ message: "Unauthorized API key" }),
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
        json: async () => ({ message: "Resend service under maintenance" }),
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
      connectionId: "conn_resend_test_123",
      capability: IntegrationCapability.EMAIL_SEND,
      action: "send",
      payload: {
        to: "customer@example.com",
        subject: "Your Work Order #1042 has been scheduled",
        html: "<p>Technician arriving at 10:00 AM</p>",
      },
      idempotencyKey: "uuidv5-resend-test-key-1234",
      correlationId: "corr-1234-5678",
      secretReference: {
        secretId: "sec_resend_123",
        version: 1,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        fingerprint: "sha256:abc12345",
        secretPayload: "re_live_api_key_valid",
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
        status: 200,
        json: async () => ({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.EMAIL_SEND);
      expect(result.providerRequestId).toBe("49a3999c-0ce1-4ea6-ab68-afcd6dc2e794");
      expect(result.data?.messageId).toBe("49a3999c-0ce1-4ea6-ab68-afcd6dc2e794");
      expect(result.data?.to).toBe("customer@example.com");

      // Verify request headers and body
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer re_live_api_key_valid",
            "Idempotency-Key": "uuidv5-resend-test-key-1234",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            from: "Aforden <notifications@aforden.com>",
            to: ["customer@example.com"],
            subject: "Your Work Order #1042 has been scheduled",
            html: "<p>Technician arriving at 10:00 AM</p>",
          }),
        })
      );
    });

    it("should translate 422 Unprocessable Entity to PAYLOAD_VALIDATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          statusCode: 422,
          name: "validation_error",
          message: "The 'from' email domain is not verified.",
        }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.httpStatusCode).toBe(422);
    });

    it("should translate 429 Rate Limited and extract Retry-After header", async () => {
      const mockHeaders = new Headers();
      mockHeaders.set("retry-after", "15");

      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: mockHeaders,
        json: async () => ({
          statusCode: 429,
          name: "rate_limit_exceeded",
          message: "Too many requests. Please slow down.",
        }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.RATE_LIMITED);
      expect(result.failure?.isRetryable).toBe(true);
      expect(result.failure?.retryAfterSeconds).toBe(15);
    });

    it("should translate 500/503 errors to SERVICE_UNAVAILABLE (retryable)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          statusCode: 500,
          name: "internal_server_error",
          message: "Resend internal mail cluster failure",
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

  describe("5. handleWebhook() Svix Signature Verification & Event Normalization", () => {
    const webhookSecret = "whsec_mfKQ9r8uJubikEn絶3C+Lw==";
    const cleanSecret = "mfKQ9r8uJubikEn絶3C+Lw==";
    const secretBuffer = Buffer.from(cleanSecret, "base64");

    it("should correctly verify valid Svix webhook signature", () => {
      const svixId = "msg_p1q2r3s4";
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const rawBody = JSON.stringify({
        type: "email.delivered",
        created_at: new Date().toISOString(),
        data: {
          email_id: "email_12345",
          to: ["client@example.com"],
          from: "notifications@aforden.com",
          subject: "Invoice #1001",
        },
      });

      const signature = crypto
        .createHmac("sha256", secretBuffer)
        .update(`${svixId}.${svixTimestamp}.${rawBody}`)
        .digest("base64");

      const headers = new Headers();
      headers.set("svix-id", svixId);
      headers.set("svix-timestamp", svixTimestamp);
      headers.set("svix-signature", `v1,${signature}`);

      const isValid = verifySvixSignature(rawBody, headers, webhookSecret);
      expect(isValid).toBe(true);
    });

    it("should reject invalid / tampered Svix signature", () => {
      const svixId = "msg_p1q2r3s4";
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const rawBody = '{"type":"email.delivered"}';

      const headers = new Headers();
      headers.set("svix-id", svixId);
      headers.set("svix-timestamp", svixTimestamp);
      headers.set("svix-signature", "v1,tampered_invalid_signature_base64==");

      const isValid = verifySvixSignature(rawBody, headers, webhookSecret);
      expect(isValid).toBe(false);
    });

    it("should reject timestamp skewed by > 300s", () => {
      const svixId = "msg_p1q2r3s4";
      const skewedTimestamp = (Math.floor(Date.now() / 1000) - 500).toString();
      const rawBody = '{"type":"email.delivered"}';

      const signature = crypto
        .createHmac("sha256", secretBuffer)
        .update(`${svixId}.${skewedTimestamp}.${rawBody}`)
        .digest("base64");

      const headers = new Headers();
      headers.set("svix-id", svixId);
      headers.set("svix-timestamp", skewedTimestamp);
      headers.set("svix-signature", `v1,${signature}`);

      const isValid = verifySvixSignature(rawBody, headers, webhookSecret);
      expect(isValid).toBe(false);
    });

    it("should process and normalize Resend delivery and bounce webhook events", async () => {
      const svixId = "msg_event_888";
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const payload = {
        type: "email.delivered",
        created_at: "2026-08-29T10:00:00.000Z",
        data: {
          email_id: "resend_msg_001",
          to: ["dispatcher@servicecompany.com"],
          from: "notifications@aforden.com",
          subject: "Work Order #402 Assigned",
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto
        .createHmac("sha256", secretBuffer)
        .update(`${svixId}.${svixTimestamp}.${rawBody}`)
        .digest("base64");

      const headers = new Headers();
      headers.set("svix-id", svixId);
      headers.set("svix-timestamp", svixTimestamp);
      headers.set("svix-signature", `v1,${signature}`);

      const secretRef: IntegrationSecretReference = {
        secretId: "sec_wh_123",
        version: 1,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        fingerprint: "sha256:wh_secret",
        secretPayload: webhookSecret,
      };

      const event = await adapter.handleWebhook(payload, headers, secretRef, mockConnection);

      expect(event).not.toBeNull();
      expect(event?.eventType).toBe("email.delivered");
      expect(event?.entityType).toBe("EmailMessage");
      expect(event?.entityId).toBe("resend_msg_001");
      expect(event?.workspaceId).toBe(mockConnection.workspaceId);
      expect(event?.connectionId).toBe(mockConnection.id);
      expect(event?.payload.status).toBe("delivered");
      expect(event?.payload.emailId).toBe("resend_msg_001");
    });
  });
});
