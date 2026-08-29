/**
 * Phase 1.17.3 — MockEmailAdapter Reference Implementation Unit Tests
 * Full method coverage for connect, disconnect, testConnection, execute (success & failures),
 * handleWebhook normalization, and capability advertisement.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockEmailAdapter } from "@/lib/integrations/adapters/mockEmailAdapter";
import {
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationFailureCode,
  type IntegrationConnection,
  type IntegrationSecretReference,
  type IntegrationExecutionRequest,
} from "@/lib/integrations/adapters/types";

describe("Phase 1.17.3 — MockEmailAdapter", () => {
  let adapter: MockEmailAdapter;
  let mockConnection: IntegrationConnection;
  let mockSecretRef: IntegrationSecretReference;

  beforeEach(() => {
    adapter = new MockEmailAdapter("mock_email", "Mock Email Provider");
    mockConnection = {
      id: "conn_test_email_123",
      workspaceId: "ws_test_456",
      integrationId: "mock_email",
      connectionKey: "default",
      status: IntegrationConnectionStatus.CONNECTED,
      configJson: {},
      metadataJson: {},
      externalAccountId: "mock_email_acc_001",
      externalAccountName: "Mock Email Sender",
      lastTestedAt: new Date(),
      lastErrorJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockSecretRef = {
      secretId: "sec_test_789",
      version: 1,
      keyVaultProvider: "LOCAL_ENCRYPTED_DB",
      algorithm: "AES_256_GCM",
      fingerprint: "sha256:valid_mock_fingerprint",
      expiresAt: new Date(Date.now() + 86400000),
    };
  });

  describe("1. Metadata & Capability Advertisement", () => {
    it("should advertise correct metadata and immutable capabilities", () => {
      expect(adapter.integrationId).toBe("mock_email");
      expect(adapter.displayName).toBe("Mock Email Provider");
      expect(adapter.version).toBe("1.0.0");
      expect(adapter.getCapabilities()).toEqual([IntegrationCapability.EMAIL_SEND]);
    });
  });

  describe("2. Connection Handshake (connect / disconnect)", () => {
    it("should perform a simulated connection handshake and return ConnectResult with external account info", async () => {
      const result = await adapter.connect(mockConnection);

      expect(result.success).toBe(true);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.CONNECTED);
      expect(result.externalAccountId).toBe("mock_email_acc_001");
      expect(result.externalAccountName).toBe("Mock Transactional Email Provider");
      expect(result.credentialReference).toBeDefined();
      expect(result.credentialReference.algorithm).toBe("AES_256_GCM");
      expect(result.metadata).toEqual({
        provider: "MockEmailService",
        region: "us-east-1",
        defaultSender: "no-reply@aforden.test",
      });
      expect(result.failure).toBeUndefined();
    });

    it("should return simulated handshake failure when simulateConnectFailure is configured", async () => {
      const failingConnection: IntegrationConnection = {
        ...mockConnection,
        configJson: { simulateConnectFailure: true },
      };

      const result = await adapter.connect(failingConnection);

      expect(result.success).toBe(false);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.ERROR);
      expect(result.failure).toBeDefined();
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.httpStatusCode).toBe(401);
      expect(result.failure?.isRetryable).toBe(false);
    });

    it("should gracefully disconnect without errors", async () => {
      await expect(adapter.disconnect(mockConnection, mockSecretRef)).resolves.toBeUndefined();
    });
  });

  describe("3. Health Check & Diagnostics (testConnection)", () => {
    it("should return healthy TestResult with latency under valid credentials", async () => {
      const result = await adapter.testConnection(mockConnection, mockSecretRef);

      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeGreaterThan(0);
      expect(result.checkedAt).toBeInstanceOf(Date);
      expect(result.details).toEqual({
        ping: "pong",
        status: "healthy",
        provider: "mock_email",
      });
      expect(result.failure).toBeUndefined();
    });

    it("should return AUTHENTICATION_FAILED failure when credential fingerprint is invalid", async () => {
      const invalidSecretRef: IntegrationSecretReference = {
        ...mockSecretRef,
        fingerprint: "invalid",
      };

      const result = await adapter.testConnection(mockConnection, invalidSecretRef);

      expect(result.success).toBe(false);
      expect(result.failure).toBeDefined();
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.httpStatusCode).toBe(401);
    });

    it("should return failure when simulateFailure flag is set in connection config", async () => {
      const failingConnection: IntegrationConnection = {
        ...mockConnection,
        configJson: { simulateFailure: true },
      };

      const result = await adapter.testConnection(failingConnection, mockSecretRef);

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
    });
  });

  describe("4. Outbound Action Execution (execute)", () => {
    const createExecutionRequest = (
      payloadOverrides: Record<string, unknown> = {},
      capability: IntegrationCapability = IntegrationCapability.EMAIL_SEND
    ): IntegrationExecutionRequest => ({
      workspaceId: "ws_test_456",
      connectionId: "conn_test_email_123",
      capability,
      action: "send",
      payload: {
        to: "customer@example.com",
        subject: "Your Work Order #WO-2026 is Complete",
        body: "Hello, your HVAC service has been completed.",
        ...payloadOverrides,
      },
      idempotencyKey: "idem_uuid5_abc123",
      correlationId: "corr_uuid4_def456",
      secretReference: mockSecretRef,
      connectionConfig: {},
    });

    it("should execute valid EMAIL_SEND request and return successful normalized result", async () => {
      const request = createExecutionRequest();
      const result = await adapter.execute(request);

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.EMAIL_SEND);
      expect(result.action).toBe("send");
      expect(result.rawResponseStatus).toBe(200);
      expect(result.providerRequestId).toMatch(/^req_mock_/);
      expect(result.data).toBeDefined();
      expect(result.data?.messageId).toMatch(/^msg_mock_/);
      expect(result.data?.to).toBe("customer@example.com");
      expect(result.data?.recipientCount).toBe(1);
      expect(result.failure).toBeUndefined();
    });

    it("should support array of recipient emails", async () => {
      const request = createExecutionRequest({
        to: ["customer1@example.com", "customer2@example.com"],
      });
      const result = await adapter.execute(request);

      expect(result.success).toBe(true);
      expect(result.data?.recipientCount).toBe(2);
    });

    it("should fail with PAYLOAD_VALIDATION_FAILED when recipient email format is invalid", async () => {
      const request = createExecutionRequest({ to: "not-an-email" });
      const result = await adapter.execute(request);

      expect(result.success).toBe(false);
      expect(result.failure).toBeDefined();
      expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
      expect(result.failure?.httpStatusCode).toBe(400);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.message).toContain("Payload validation failed");
    });

    it("should fail with PAYLOAD_VALIDATION_FAILED when subject is missing or empty", async () => {
      const request = createExecutionRequest({ subject: "" });
      const result = await adapter.execute(request);

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
    });

    it("should fail with CAPABILITY_UNSUPPORTED when invoked with a non-email capability", async () => {
      const request = createExecutionRequest({}, IntegrationCapability.SMS_SEND);
      const result = await adapter.execute(request);

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.CAPABILITY_UNSUPPORTED);
      expect(result.failure?.isRetryable).toBe(false);
    });

    it("should simulate RATE_LIMITED failure with retry-after header when requested in payload", async () => {
      const request = createExecutionRequest({ simulateRateLimit: true });
      const result = await adapter.execute(request);

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.RATE_LIMITED);
      expect(result.failure?.isRetryable).toBe(true);
      expect(result.failure?.retryAfterSeconds).toBe(30);
      expect(result.failure?.httpStatusCode).toBe(429);
    });

    it("should simulate NETWORK_TIMEOUT failure when requested in payload", async () => {
      const request = createExecutionRequest({ simulateNetworkTimeout: true });
      const result = await adapter.execute(request);

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.NETWORK_TIMEOUT);
      expect(result.failure?.isRetryable).toBe(true);
      expect(result.failure?.httpStatusCode).toBe(504);
    });
  });

  describe("5. Inbound Webhook Normalization (handleWebhook)", () => {
    it("should normalize a simulated delivery webhook into a standard IntegrationEvent", async () => {
      const headers = new Headers({
        "x-mock-signature": "valid_sig_123",
        "content-type": "application/json",
      });
      const payload = {
        eventId: "evt_delivered_999",
        eventType: "email.delivered",
        messageId: "msg_mock_888",
        recipient: "customer@example.com",
        occurredAt: "2026-08-29T10:00:00.000Z",
      };

      const event = await adapter.handleWebhook(payload, headers, mockSecretRef, mockConnection);

      expect(event).not.toBeNull();
      expect(event?.eventId).toBe("evt_delivered_999");
      expect(event?.eventType).toBe("email.delivered");
      expect(event?.workspaceId).toBe("ws_test_456");
      expect(event?.connectionId).toBe("conn_test_email_123");
      expect(event?.entityType).toBe("EmailMessage");
      expect(event?.entityId).toBe("msg_mock_888");
      expect(event?.payload).toEqual(payload);
      expect(event?.rawPayloadHash).toBeDefined();
      expect(event?.occurredAt).toEqual(new Date("2026-08-29T10:00:00.000Z"));
    });

    it("should reject webhook and return null if signature is invalid", async () => {
      const headers = new Headers({
        "x-mock-signature": "invalid",
      });
      const payload = { eventId: "evt_1" };

      const event = await adapter.handleWebhook(payload, headers, mockSecretRef, mockConnection);
      expect(event).toBeNull();
    });

    it("should return null if payload is null or not an object", async () => {
      const headers = new Headers();
      expect(await adapter.handleWebhook(null, headers, mockSecretRef, mockConnection)).toBeNull();
      expect(await adapter.handleWebhook("not-an-object", headers, mockSecretRef, mockConnection)).toBeNull();
    });
  });
});
