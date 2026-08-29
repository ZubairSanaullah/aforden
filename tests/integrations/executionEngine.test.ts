import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationCredentialStatus,
  IntegrationExecutionStatus,
  IntegrationFailureCode,
} from "@/generated/prisma/client";
import { seedIntegrationCatalog } from "@/lib/integrations/seed/integrationSeed";
import { AdapterRegistry } from "@/lib/integrations/adapters/adapterRegistry";
import { MockEmailAdapter } from "@/lib/integrations/adapters/mockEmailAdapter";
import {
  resolveCapabilityConnection,
  executeCapability,
  generateOutboundIdempotencyKey,
  redactSensitiveData,
} from "@/lib/integrations/execution";
import {
  ConnectionNotReadyError,
  AmbiguousCapabilityProviderError,
  CapabilityProviderNotConfiguredError,
} from "@/lib/integrations/integrationErrors";
import { PlanFeatureNotEnabledError } from "@/lib/services/billing/billingErrors";

describe("Phase 1.17.5 — Outbound Integration Engine", () => {
  let prisma: PrismaClient;
  let testWorkspaceId: string;
  let testConnectionId: string;
  const createdWorkspaceIds: string[] = [];
  const testApiKey = "re_test_live_secret_key_123456789";

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await seedIntegrationCatalog(prisma);

    // Upsert sendgrid catalog row for multi-provider test cases
    await prisma.integration.upsert({
      where: { id: "sendgrid" },
      create: {
        id: "sendgrid",
        name: "SendGrid Email Provider",
        capabilities: [IntegrationCapability.EMAIL_SEND],
        status: "ACTIVE",
      },
      update: {},
    });
  });

  afterAll(async () => {
    AdapterRegistry.clearAdapters();
    for (const wsId of createdWorkspaceIds) {
      await prisma.workspace.delete({ where: { id: wsId } }).catch(() => {});
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    AdapterRegistry.clearAdapters();
    AdapterRegistry.registerAdapter(new MockEmailAdapter("resend", "Resend Mock"), {
      allowOverride: true,
    });
    AdapterRegistry.registerAdapter(new MockEmailAdapter("sendgrid", "SendGrid Mock"), {
      allowOverride: true,
      skipCatalogValidation: true,
    });

    const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ws = await prisma.workspace.create({
      data: {
        name: `Execution Test WS ${runId}`,
        slug: `ws-exec-${runId}`,
      },
    });
    testWorkspaceId = ws.id;
    createdWorkspaceIds.push(testWorkspaceId);


    // Grant FEATURE_API_ACCESS entitlement override
    await prisma.workspaceEntitlementOverride.create({
      data: {
        workspaceId: testWorkspaceId,
        featureKey: "FEATURE_API_ACCESS",
        featureType: "BOOLEAN",
        overrideValueJson: true,
        reason: "Outbound execution testing",
        grantedByUserId: "test_admin",
      },
    });

    // Create active Resend connection
    const conn = await prisma.integrationConnection.create({
      data: {
        workspaceId: testWorkspaceId,
        integrationId: "resend",
        connectionKey: "default",
        status: IntegrationConnectionStatus.CONNECTED,
        configJson: {},
      },
    });
    testConnectionId = conn.id;

    // Create active credential
    await prisma.integrationCredential.create({
      data: {
        connectionId: testConnectionId,
        version: 1,
        status: IntegrationCredentialStatus.ACTIVE,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        iv: "iv_123",
        tag: "tag_123",
        encryptedData: `plain:${testApiKey}`,
        fingerprint: `sha256:${crypto.createHash("sha256").update(testApiKey).digest("hex")}`,
      },
    });
  });

  // =========================================================================
  // 1. CAPABILITY RESOLVER TESTS
  // =========================================================================
  describe("Capability Resolver (resolveCapabilityConnection)", () => {
    it("should throw PlanFeatureNotEnabledError when workspace lacks FEATURE_API_ACCESS entitlement", async () => {
      // Remove entitlement override
      await prisma.workspaceEntitlementOverride.deleteMany({
        where: {
          workspaceId: testWorkspaceId,
          featureKey: "FEATURE_API_ACCESS",
        },
      });

      await expect(
        resolveCapabilityConnection(testWorkspaceId, IntegrationCapability.EMAIL_SEND, {
          dbClient: prisma,
        })
      ).rejects.toThrow(PlanFeatureNotEnabledError);
    });

    it("should resolve single active connection for capability", async () => {
      const resolved = await resolveCapabilityConnection(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        { dbClient: prisma }
      );

      expect(resolved.id).toBe(testConnectionId);
      expect(resolved.integrationId).toBe("resend");
      expect(resolved.status).toBe(IntegrationConnectionStatus.CONNECTED);
    });

    it("should throw CapabilityProviderNotConfiguredError when zero connections exist for capability", async () => {
      await expect(
        resolveCapabilityConnection(
          testWorkspaceId,
          IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
          { dbClient: prisma }
        )
      ).rejects.toThrow(CapabilityProviderNotConfiguredError);
    });

    it("should throw ConnectionNotReadyError when matching connection is in DISCONNECTED status", async () => {
      await prisma.integrationConnection.update({
        where: { id: testConnectionId },
        data: { status: IntegrationConnectionStatus.DISCONNECTED },
      });

      await expect(
        resolveCapabilityConnection(testWorkspaceId, IntegrationCapability.EMAIL_SEND, {
          dbClient: prisma,
        })
      ).rejects.toThrow(ConnectionNotReadyError);
    });

    it("should throw AmbiguousCapabilityProviderError when multiple multi-provider connections exist with no default", async () => {
      // Add second active connection (SendGrid)
      await prisma.integrationConnection.create({
        data: {
          workspaceId: testWorkspaceId,
          integrationId: "sendgrid",
          connectionKey: "backup",
          status: IntegrationConnectionStatus.CONNECTED,
          configJson: {},
        },
      });

      await expect(
        resolveCapabilityConnection(testWorkspaceId, IntegrationCapability.EMAIL_SEND, {
          dbClient: prisma,
        })
      ).rejects.toThrow(AmbiguousCapabilityProviderError);
    });

    it("should resolve default provider preference from WorkspaceIntegrationSetting.defaultProvidersJson", async () => {
      // Add second connection (SendGrid)
      const sendgridConn = await prisma.integrationConnection.create({
        data: {
          workspaceId: testWorkspaceId,
          integrationId: "sendgrid",
          connectionKey: "backup",
          status: IntegrationConnectionStatus.CONNECTED,
          configJson: {},
        },
      });

      // Configure default preference for EMAIL_SEND -> "sendgrid"
      await prisma.workspaceIntegrationSetting.create({
        data: {
          workspaceId: testWorkspaceId,
          defaultProvidersJson: {
            [IntegrationCapability.EMAIL_SEND]: "sendgrid",
          },
        },
      });

      const resolved = await resolveCapabilityConnection(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        { dbClient: prisma }
      );

      expect(resolved.id).toBe(sendgridConn.id);
      expect(resolved.integrationId).toBe("sendgrid");
    });

    it("should honor explicit providerHint even when default preference is configured", async () => {
      // Add SendGrid and set it as default
      await prisma.integrationConnection.create({
        data: {
          workspaceId: testWorkspaceId,
          integrationId: "sendgrid",
          connectionKey: "backup",
          status: IntegrationConnectionStatus.CONNECTED,
          configJson: {},
        },
      });

      await prisma.workspaceIntegrationSetting.create({
        data: {
          workspaceId: testWorkspaceId,
          defaultProvidersJson: {
            [IntegrationCapability.EMAIL_SEND]: "sendgrid",
          },
        },
      });

      // Pass hint: "resend"
      const resolved = await resolveCapabilityConnection(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        {
          providerHint: "resend",
          dbClient: prisma,
        }
      );

      expect(resolved.id).toBe(testConnectionId);
      expect(resolved.integrationId).toBe("resend");
    });
  });

  // =========================================================================
  // 2. DETERMINISTIC UUIDv5 IDEMPOTENCY KEY TESTS
  // =========================================================================
  describe("Deterministic Idempotency Key (generateOutboundIdempotencyKey)", () => {
    it("should generate identical UUIDv5 for identical payload regardless of key ordering", () => {
      const payload1 = { to: "user@test.com", subject: "Hello", priority: 1 };
      const payload2 = { priority: 1, subject: "Hello", to: "user@test.com" };

      const key1 = generateOutboundIdempotencyKey(
        testWorkspaceId,
        testConnectionId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload1
      );

      const key2 = generateOutboundIdempotencyKey(
        testWorkspaceId,
        testConnectionId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload2
      );

      expect(key1).toBe(key2);
      expect(key1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("should generate distinct UUIDv5 when action or payload changes", () => {
      const key1 = generateOutboundIdempotencyKey(
        testWorkspaceId,
        testConnectionId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        { to: "user1@test.com", subject: "Hello" }
      );

      const key2 = generateOutboundIdempotencyKey(
        testWorkspaceId,
        testConnectionId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        { to: "user2@test.com", subject: "Hello" }
      );

      const key3 = generateOutboundIdempotencyKey(
        testWorkspaceId,
        testConnectionId,
        IntegrationCapability.EMAIL_SEND,
        "send_batch",
        { to: "user1@test.com", subject: "Hello" }
      );

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });

  // =========================================================================
  // 3. CREDENTIAL REDACTION ENGINE TESTS
  // =========================================================================
  describe("Redaction Engine (redactSensitiveData)", () => {
    it("should recursively mask sensitive keys with [REDACTED]", () => {
      const sensitivePayload = {
        recipient: "customer@aforden.test",
        apiKey: "re_secret_key_12345",
        password: "super_secret_password",
        nested: {
          token: "bearer_xyz_789",
          authorization: "Bearer my-token",
          publicData: "visible",
        },
        items: [
          { secret: "hidden", id: "item_1" },
          { name: "item_2" },
        ],
      };

      const redacted = redactSensitiveData(sensitivePayload);

      expect(redacted.apiKey).toBe("[REDACTED]");
      expect(redacted.password).toBe("[REDACTED]");
      expect(redacted.recipient).toBe("customer@aforden.test");
      expect(redacted.nested.token).toBe("[REDACTED]");
      expect(redacted.nested.authorization).toBe("[REDACTED]");
      expect(redacted.nested.publicData).toBe("visible");
      expect(redacted.items[0].secret).toBe("[REDACTED]");
      expect(redacted.items[0].id).toBe("item_1");
    });
  });

  // =========================================================================
  // 4. END-TO-END EXECUTION & AUDIT LEDGER TESTS
  // =========================================================================
  describe("End-to-End Execution (executeCapability)", () => {
    it("should execute capability, return successful result, and record COMPLETED audit ledger", async () => {
      const payload = {
        to: "customer@aforden.test",
        subject: "Work Order #1042 Completed",
        body: "Your HVAC service has been completed.",
      };

      const result = await executeCapability(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload,
        { dbClient: prisma }
      );

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.EMAIL_SEND);
      expect(result.action).toBe("send_email");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.data).toBeDefined();
      expect(result.data?.messageId).toBeDefined();

      // Verify persisted IntegrationExecution record in database
      const executionRecord = await prisma.integrationExecution.findFirst({
        where: {
          workspaceId: testWorkspaceId,
          connectionId: testConnectionId,
          action: "send_email",
        },
      });

      expect(executionRecord).toBeDefined();
      expect(executionRecord?.status).toBe(IntegrationExecutionStatus.COMPLETED);
      expect(executionRecord?.rawResponseStatus).toBe(200);
      expect(executionRecord?.idempotencyKey).toBeDefined();
      expect(executionRecord?.correlationId).toBeDefined();
      expect(executionRecord?.startedAt).toBeInstanceOf(Date);
      expect(executionRecord?.completedAt).toBeInstanceOf(Date);
      expect(executionRecord?.durationMs).toBeGreaterThanOrEqual(0);
    }, 15000);

    it("should generate identical idempotency key on repeated calls while executing each attempt independently", async () => {
      const payload = {
        to: "idempotent@aforden.test",
        subject: "Invoice #501",
        body: "Invoice payment link.",
      };

      // Call 1
      const result1 = await executeCapability(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload,
        { dbClient: prisma }
      );

      // Call 2
      const result2 = await executeCapability(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload,
        { dbClient: prisma }
      );

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      const executions = await prisma.integrationExecution.findMany({
        where: {
          workspaceId: testWorkspaceId,
          connectionId: testConnectionId,
          action: "send_email",
        },
        orderBy: { createdAt: "asc" },
      });

      // Both executions occurred
      expect(executions.length).toBe(2);
      // Both executions share the exact same deterministic UUIDv5 idempotency key
      expect(executions[0].idempotencyKey).toBe(executions[1].idempotencyKey);
      // But have distinct execution record IDs
      expect(executions[0].id).not.toBe(executions[1].id);
    }, 15000);

    it("should redact sensitive fields in IntegrationExecution request snapshot", async () => {
      const payloadWithSecrets = {
        to: "customer@aforden.test",
        subject: "Credentials Update",
        body: "Your secret access details.",
        apiKey: "re_super_secret_payload_key",
        password: "my_plain_password_123",
        token: "bearer_xyz_token",
      };

      await executeCapability(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payloadWithSecrets,
        { dbClient: prisma }
      );

      const executionRecord = await prisma.integrationExecution.findFirst({
        where: {
          workspaceId: testWorkspaceId,
          connectionId: testConnectionId,
        },
      });

      expect(executionRecord).toBeDefined();
      const snapshot = executionRecord?.requestSnapshotJson as Record<string, unknown>;
      expect(snapshot.to).toBe("customer@aforden.test");
      expect(snapshot.apiKey).toBe("[REDACTED]");
      expect(snapshot.password).toBe("[REDACTED]");
      expect(snapshot.token).toBe("[REDACTED]");
    }, 15000);

    it("should enforce timeout and record TIMED_OUT in execution ledger", async () => {
      const payloadWithDelay = {
        to: "slow@aforden.test",
        subject: "Slow Delivery",
        body: "This message takes 300ms.",
        simulateDelayMs: 300,
      };

      const result = await executeCapability(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payloadWithDelay,
        {
          timeoutMs: 50, // Strict 50ms timeout
          dbClient: prisma,
        }
      );

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.NETWORK_TIMEOUT);
      expect(result.failure?.isRetryable).toBe(true);

      const executionRecord = await prisma.integrationExecution.findFirst({
        where: {
          workspaceId: testWorkspaceId,
          connectionId: testConnectionId,
          status: IntegrationExecutionStatus.TIMED_OUT,
        },
      });

      expect(executionRecord).toBeDefined();
      expect(executionRecord?.failureCode).toBe(IntegrationFailureCode.NETWORK_TIMEOUT);
    }, 15000);

    it("should record FAILED status and failure details when adapter execution fails", async () => {
      const rateLimitedPayload = {
        to: "rate-limited@aforden.test",
        subject: "Rate Limit Test",
        body: "Hello",
        simulateRateLimit: true,
      };

      const result = await executeCapability(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        rateLimitedPayload,
        { dbClient: prisma }
      );

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.RATE_LIMITED);
      expect(result.rawResponseStatus).toBe(429);

      const executionRecord = await prisma.integrationExecution.findFirst({
        where: {
          workspaceId: testWorkspaceId,
          connectionId: testConnectionId,
          status: IntegrationExecutionStatus.FAILED,
        },
      });

      expect(executionRecord).toBeDefined();
      expect(executionRecord?.failureCode).toBe(IntegrationFailureCode.RATE_LIMITED);
      expect(executionRecord?.rawResponseStatus).toBe(429);
    }, 15000);
  });
});
