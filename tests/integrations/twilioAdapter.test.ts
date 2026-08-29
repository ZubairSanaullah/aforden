/**
 * Phase 1.17.7 — TwilioAdapter Contract, Execution, Error Translation & Webhook Tests
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  TwilioAdapter,
  verifyTwilioSignature,
} from "@/lib/integrations/adapters/twilioAdapter";
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

describe("Phase 1.17.7 — TwilioAdapter Unit & Contract Tests", () => {
  let adapter: TwilioAdapter;
  let mockConnection: IntegrationConnection;
  let mockSecretRef: IntegrationSecretReference;

  const sampleAccountSid = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const sampleAuthToken = "auth_token_mock_secret_12345678";

  beforeEach(() => {
    adapter = new TwilioAdapter();
    mockConnection = {
      id: "conn_twilio_test_123",
      workspaceId: "ws_test_456",
      integrationId: "twilio",
      connectionKey: "primary",
      status: IntegrationConnectionStatus.CONNECTED,
      configJson: {
        accountSid: sampleAccountSid,
        fromPhoneNumber: "+15005550006",
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
      secretId: "sec_twilio_123",
      version: 1,
      keyVaultProvider: "LOCAL_ENCRYPTED_DB",
      algorithm: "AES_256_GCM",
      fingerprint: "sha256:tw12345",
      secretPayload: JSON.stringify({
        accountSid: sampleAccountSid,
        authToken: sampleAuthToken,
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Identity & Capability Registration", () => {
    it("should report correct identity metadata and capabilities", () => {
      expect(adapter.integrationId).toBe("twilio");
      expect(adapter.displayName).toBe("Twilio");
      expect(adapter.version).toBe("1.0.0");
      expect(adapter.getCapabilities()).toEqual([IntegrationCapability.SMS_SEND]);
    });

    it("should register successfully and pass catalog subset validation", () => {
      AdapterRegistry.clearAdapters();
      AdapterRegistry.registerAdapter(adapter);
      expect(AdapterRegistry.hasAdapter("twilio")).toBe(true);

      // Verify that [SMS_SEND] is a valid subset of catalog entry [SMS_SEND, WEBHOOK_RECEIVE]
      expect(() =>
        AdapterRegistry.validateAdapterCatalogConsistency(SEED_INTEGRATIONS)
      ).not.toThrow();
    });
  });

  describe("2. connect() Handshake", () => {
    it("should fail connect() when accountSid or authToken is missing", async () => {
      const connWithoutCreds = { ...mockConnection, configJson: {} };
      const prevSid = process.env.TWILIO_ACCOUNT_SID;
      const prevToken = process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;

      try {
        const result = await adapter.connect(connWithoutCreds);
        expect(result.success).toBe(false);
        expect(result.connectionStatus).toBe(IntegrationConnectionStatus.ERROR);
        expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
        expect(result.failure?.httpStatusCode).toBe(401);
      } finally {
        if (prevSid) process.env.TWILIO_ACCOUNT_SID = prevSid;
        if (prevToken) process.env.TWILIO_AUTH_TOKEN = prevToken;
      }
    });

    it("should return CONNECTED on valid Twilio account credentials ping", async () => {
      const basicAuth = Buffer.from(`${sampleAccountSid}:${sampleAuthToken}`).toString("base64");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sid: sampleAccountSid,
          friendly_name: "Field Operations Production",
          status: "active",
        }),
      } as unknown as Response);

      const result = await adapter.connect(mockConnection, {
        accountSid: sampleAccountSid,
        authToken: sampleAuthToken,
      });

      expect(result.success).toBe(true);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.CONNECTED);
      expect(result.externalAccountId).toBe(sampleAccountSid);
      expect(result.externalAccountName).toBe("Field Operations Production");

      expect(fetchSpy).toHaveBeenCalledWith(
        `https://api.twilio.com/2010-04-01/Accounts/${sampleAccountSid}.json`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Basic ${basicAuth}`,
          }),
        })
      );
    });

    it("should translate 401 error response to AUTHENTICATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          code: 20003,
          message: "Authenticate: Your Account SID or Auth Token was incorrect.",
        }),
      } as unknown as Response);

      const result = await adapter.connect(mockConnection, {
        accountSid: sampleAccountSid,
        authToken: "wrong_token",
      });

      expect(result.success).toBe(false);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.ERROR);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.providerRawCode).toBe("20003");
    });

    it("should translate network connection failure to NETWORK_TIMEOUT", async () => {
      vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

      const result = await adapter.connect(mockConnection, {
        accountSid: sampleAccountSid,
        authToken: sampleAuthToken,
      });

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
        json: async () => ({ sid: sampleAccountSid }),
      } as unknown as Response);

      const result = await adapter.testConnection(mockConnection, mockSecretRef);
      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.checkedAt).toBeInstanceOf(Date);
      expect(result.details?.accountSid).toBe(sampleAccountSid);
    });

    it("should return AUTHENTICATION_FAILED on 401 response", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ code: 20003, message: "Authentication failed" }),
      } as unknown as Response);

      const result = await adapter.testConnection(mockConnection, mockSecretRef);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
    });

    it("should return SERVICE_UNAVAILABLE on 503 response", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ message: "Twilio Gateway Unavailable" }),
      } as unknown as Response);

      const result = await adapter.testConnection(mockConnection, mockSecretRef);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);
      expect(result.failure?.isRetryable).toBe(true);
    });
  });

  describe("4. execute() Outbound SMS Dispatch & Error Translations", () => {
    const baseRequest: IntegrationExecutionRequest = {
      workspaceId: "ws_test_456",
      connectionId: "conn_twilio_test_123",
      capability: IntegrationCapability.SMS_SEND,
      action: "send",
      payload: {
        to: "+15551234567",
        body: "Technician Alex is en route to your service location.",
      },
      idempotencyKey: "uuidv5-twilio-test-key-5678",
      correlationId: "corr-5678-9012",
      secretReference: {
        secretId: "sec_twilio_123",
        version: 1,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        fingerprint: "sha256:tw12345",
        secretPayload: JSON.stringify({
          accountSid: sampleAccountSid,
          authToken: sampleAuthToken,
        }),
      },
      connectionConfig: {
        accountSid: sampleAccountSid,
        fromPhoneNumber: "+15005550006",
      },
    };

    it("should reject unsupported capability with CAPABILITY_UNSUPPORTED", async () => {
      const result = await adapter.execute({
        ...baseRequest,
        capability: IntegrationCapability.EMAIL_SEND,
      });

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.CAPABILITY_UNSUPPORTED);
      expect(result.failure?.isRetryable).toBe(false);
    });

    it("should fail validation on missing phone number, body, or from sender", async () => {
      // Missing 'to'
      const resMissingTo = await adapter.execute({
        ...baseRequest,
        payload: { body: "Hello" },
      });
      expect(resMissingTo.success).toBe(false);
      expect(resMissingTo.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);

      // Missing 'body'
      const resMissingBody = await adapter.execute({
        ...baseRequest,
        payload: { to: "+15551234567" },
      });
      expect(resMissingBody.success).toBe(false);
      expect(resMissingBody.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);

      // Missing from & messagingServiceSid
      const resMissingSender = await adapter.execute({
        ...baseRequest,
        connectionConfig: { accountSid: sampleAccountSid },
        payload: { to: "+15551234567", body: "Hello" },
      });
      expect(resMissingSender.success).toBe(false);
      expect(resMissingSender.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
    });

    it("should successfully send SMS and return normalized result", async () => {
      const basicAuth = Buffer.from(`${sampleAccountSid}:${sampleAuthToken}`).toString("base64");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          sid: "SM88888888888888888888888888888888",
          status: "queued",
          to: "+15551234567",
          from: "+15005550006",
          num_segments: "1",
          date_created: "Wed, 29 Aug 2026 10:00:00 +0000",
        }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.SMS_SEND);
      expect(result.providerRequestId).toBe("SM88888888888888888888888888888888");
      expect(result.data?.messageSid).toBe("SM88888888888888888888888888888888");
      expect(result.data?.to).toBe("+15551234567");
      expect(result.data?.status).toBe("queued");

      // Verify POST body format and Auth
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://api.twilio.com/2010-04-01/Accounts/${sampleAccountSid}/Messages.json`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        })
      );
    });

    it("should translate Twilio error 20003 to AUTHENTICATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          code: 20003,
          message: "Authenticate: Your Account SID or Auth Token was incorrect.",
        }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.providerRawCode).toBe("20003");
    });

    it("should translate Twilio error 21211 (invalid number) to PAYLOAD_VALIDATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          code: 21211,
          message: "The 'To' number is not a valid phone number.",
        }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.providerRawCode).toBe("21211");
    });

    it("should translate Twilio error 20429 (rate limited) to RATE_LIMITED (retryable)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          code: 20429,
          message: "Too Many Requests",
        }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.RATE_LIMITED);
      expect(result.failure?.isRetryable).toBe(true);
      expect(result.failure?.retryAfterSeconds).toBe(30);
    });

    it("should translate Twilio error 20500 to SERVICE_UNAVAILABLE (retryable)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          code: 20500,
          message: "Internal Server Error",
        }),
      } as unknown as Response);

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);
      expect(result.failure?.isRetryable).toBe(true);
    });

    it("should translate network connection timeout to NETWORK_TIMEOUT", async () => {
      vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ETIMEDOUT"));

      const result = await adapter.execute(baseRequest);
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.NETWORK_TIMEOUT);
      expect(result.failure?.isRetryable).toBe(true);
    });
  });

  describe("5. handleWebhook() X-Twilio-Signature Verification & Event Normalization", () => {
    const webhookUrl = "https://app.aforden.com/api/integrations/webhooks/endpoints/conn_twilio_test_123";
    const webhookParams: Record<string, string> = {
      MessageSid: "SM99999999999999999999999999999999",
      MessageStatus: "delivered",
      To: "+15551234567",
      From: "+15005550006",
    };

    it("should correctly compute and verify valid Twilio HMAC-SHA1 signature", () => {
      // Sort keys alphabetically
      const sortedKeys = Object.keys(webhookParams).sort();
      let dataToSign = webhookUrl;
      for (const key of sortedKeys) {
        dataToSign += `${key}${webhookParams[key]}`;
      }

      const signature = crypto
        .createHmac("sha1", sampleAuthToken)
        .update(dataToSign)
        .digest("base64");

      const isValid = verifyTwilioSignature(webhookUrl, webhookParams, signature, sampleAuthToken);
      expect(isValid).toBe(true);
    });

    it("should reject invalid / tampered Twilio signature", () => {
      const isValid = verifyTwilioSignature(
        webhookUrl,
        webhookParams,
        "tampered_twilio_signature_base64==",
        sampleAuthToken
      );
      expect(isValid).toBe(false);
    });

    it("should process and normalize Twilio delivery status callback", async () => {
      const sortedKeys = Object.keys(webhookParams).sort();
      let dataToSign = webhookUrl;
      for (const key of sortedKeys) {
        dataToSign += `${key}${webhookParams[key]}`;
      }

      const signature = crypto
        .createHmac("sha1", sampleAuthToken)
        .update(dataToSign)
        .digest("base64");

      const headers = new Headers();
      headers.set("x-twilio-signature", signature);
      headers.set("x-original-url", webhookUrl);

      const event = await adapter.handleWebhook(webhookParams, headers, mockSecretRef, mockConnection);

      expect(event).not.toBeNull();
      expect(event?.eventType).toBe("sms.delivered");
      expect(event?.entityType).toBe("SmsMessage");
      expect(event?.entityId).toBe("SM99999999999999999999999999999999");
      expect(event?.workspaceId).toBe(mockConnection.workspaceId);
      expect(event?.connectionId).toBe(mockConnection.id);
      expect(event?.payload.status).toBe("delivered");
      expect(event?.payload.to).toBe("+15551234567");
    });
  });
});
