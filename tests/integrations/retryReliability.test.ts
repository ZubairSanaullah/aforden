import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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
  executeCapabilityWithRetry,
  computeBackoffDelayMs,
} from "@/lib/integrations/execution";
import type {
  IntegrationExecutionRequest,
  IntegrationExecutionResult,
} from "@/lib/integrations/adapters/types";

/**
 * Test mock adapter that fails with retryable error until target attempt count is reached.
 */
class FlakyMockEmailAdapter extends MockEmailAdapter {
  public callCount = 0;
  constructor(
    integrationId: string = "resend",
    private failUntilAttempt: number = 2
  ) {
    super(integrationId, "Flaky Mock Email");
  }

  public override async execute(
    request: IntegrationExecutionRequest
  ): Promise<IntegrationExecutionResult> {
    this.callCount++;
    if (this.callCount < this.failUntilAttempt) {
      return {
        success: false,
        capability: IntegrationCapability.EMAIL_SEND,
        action: request.action,
        durationMs: 10,
        rawResponseStatus: 504,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: `Transient timeout on attempt ${this.callCount}`,
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
    return super.execute(request);
  }
}

describe("Phase 1.17.6 — Outbound Integration Reliability & Retry Orchestrator", () => {
  let prisma: PrismaClient;
  let testWorkspaceId: string;
  let testConnectionId: string;
  const createdWorkspaceIds: string[] = [];
  const testApiKey = "re_test_reliability_secret_key_123456789";

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    await seedIntegrationCatalog(prisma);
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

    const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ws = await prisma.workspace.create({
      data: {
        name: `Reliability Test WS ${runId}`,
        slug: `ws-rel-${runId}`,
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
        reason: "Reliability testing",
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
        iv: "iv_rel",
        tag: "tag_rel",
        encryptedData: `plain:${testApiKey}`,
        fingerprint: `sha256:${crypto.createHash("sha256").update(testApiKey).digest("hex")}`,
      },
    });
  });

  // =========================================================================
  // 1. BACKOFF DELAY CALCULATION TESTS
  // =========================================================================
  describe("Backoff Delay Calculation (computeBackoffDelayMs)", () => {
    it("should compute exponential backoff with ceiling at 30s", () => {
      const delay1 = computeBackoffDelayMs(1, { baseDelayMs: 500, jitter: false });
      const delay2 = computeBackoffDelayMs(2, { baseDelayMs: 500, jitter: false });
      const delay3 = computeBackoffDelayMs(3, { baseDelayMs: 500, jitter: false });
      const delayLarge = computeBackoffDelayMs(10, { baseDelayMs: 500, maxDelayMs: 30000, jitter: false });

      expect(delay1).toBe(1000); // 2^1 * 500
      expect(delay2).toBe(2000); // 2^2 * 500
      expect(delay3).toBe(4000); // 2^3 * 500
      expect(delayLarge).toBe(30000); // capped at 30s
    });

    it("should honor retryAfterSeconds over exponential backoff", () => {
      const delay = computeBackoffDelayMs(1, {
        baseDelayMs: 500,
        retryAfterSeconds: 15,
      });

      expect(delay).toBe(15000);
    });
  });

  // =========================================================================
  // 2. RETRY ORCHESTRATION TESTS
  // =========================================================================
  describe("executeCapabilityWithRetry", () => {
    it("should retry a transient failure and succeed on 2nd attempt", async () => {
      const flakyAdapter = new FlakyMockEmailAdapter("resend", 2);
      AdapterRegistry.registerAdapter(flakyAdapter, { allowOverride: true });

      const sleepSpy = vi.fn().mockResolvedValue(undefined);

      const payload = {
        to: "customer@aforden.test",
        subject: "Order Confirmation",
        body: "Your order has been confirmed.",
      };

      const result = await executeCapabilityWithRetry(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload,
        {
          dbClient: prisma,
          sleepFn: sleepSpy,
          jitter: false,
        }
      );

      expect(result.success).toBe(true);
      expect(flakyAdapter.callCount).toBe(2);
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).toHaveBeenCalledWith(1000); // 2^1 * 500ms

      // Verify audit ledger contains exactly 2 attempt records
      const executions = await prisma.integrationExecution.findMany({
        where: {
          workspaceId: testWorkspaceId,
          connectionId: testConnectionId,
          action: "send_email",
        },
        orderBy: { attemptNumber: "asc" },
      });

      expect(executions.length).toBe(2);
      expect(executions[0].attemptNumber).toBe(1);
      expect(executions[0].status).toBe(IntegrationExecutionStatus.FAILED);
      expect(executions[0].failureCode).toBe(IntegrationFailureCode.NETWORK_TIMEOUT);

      expect(executions[1].attemptNumber).toBe(2);
      expect(executions[1].status).toBe(IntegrationExecutionStatus.COMPLETED);

      // Both attempts share the same correlationId and idempotencyKey
      expect(executions[0].correlationId).toBe(executions[1].correlationId);
      expect(executions[0].idempotencyKey).toBe(executions[1].idempotencyKey);
    }, 15000);

    it("should exhaust all 3 attempts on persistent retryable error and leave connection in CONNECTED status", async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);

      const payload = {
        to: "customer@aforden.test",
        subject: "Invoice #101",
        body: "Payment receipt",
        simulateServiceUnavailable: true,
      };

      const result = await executeCapabilityWithRetry(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload,
        {
          maxAttempts: 3,
          dbClient: prisma,
          sleepFn: sleepSpy,
        }
      );

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);
      expect(sleepSpy).toHaveBeenCalledTimes(2); // Retries after attempt 1 and attempt 2

      // Verify ledger has 3 attempts
      const executions = await prisma.integrationExecution.findMany({
        where: {
          workspaceId: testWorkspaceId,
          connectionId: testConnectionId,
          action: "send_email",
        },
        orderBy: { attemptNumber: "asc" },
      });

      expect(executions.length).toBe(3);
      expect(executions.map((e) => e.attemptNumber)).toEqual([1, 2, 3]);
      expect(executions.every((e) => e.status === IntegrationExecutionStatus.FAILED)).toBe(true);

      // Verify connection remains CONNECTED (transient failure does not trigger ERROR)
      const connection = await prisma.integrationConnection.findUnique({
        where: { id: testConnectionId },
      });
      expect(connection?.status).toBe(IntegrationConnectionStatus.CONNECTED);
    }, 15000);

    it("should immediately terminate without retry on non-retryable failure", async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);

      const payload = {
        to: "invalid-email-address", // Invalid recipient
        subject: "Hello",
        body: "Body",
      };

      const result = await executeCapabilityWithRetry(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload,
        {
          maxAttempts: 3,
          dbClient: prisma,
          sleepFn: sleepSpy,
        }
      );

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(sleepSpy).toHaveBeenCalledTimes(0); // Zero retries

      const executions = await prisma.integrationExecution.findMany({
        where: {
          workspaceId: testWorkspaceId,
          connectionId: testConnectionId,
        },
      });
      expect(executions.length).toBe(1);
    }, 15000);

    it("should transition connection to ERROR status on AUTHENTICATION_FAILED (401)", async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);

      const payload = {
        to: "customer@aforden.test",
        subject: "Security Notification",
        body: "Notice",
        simulateAuthFailure: true,
        authStatusCode: 401,
      };

      const result = await executeCapabilityWithRetry(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload,
        {
          maxAttempts: 3,
          dbClient: prisma,
          sleepFn: sleepSpy,
        }
      );

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(sleepSpy).toHaveBeenCalledTimes(0); // Zero retries

      // Assert connection status is transitioned to ERROR in database
      const connection = await prisma.integrationConnection.findUnique({
        where: { id: testConnectionId },
      });
      expect(connection?.status).toBe(IntegrationConnectionStatus.ERROR);
    }, 15000);

    it("should transition connection to ERROR status on AUTHENTICATION_FAILED (403)", async () => {
      const payload = {
        to: "customer@aforden.test",
        subject: "Security Notice",
        body: "Notice",
        simulateAuthFailure: true,
        authStatusCode: 403,
      };

      const result = await executeCapabilityWithRetry(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload,
        {
          dbClient: prisma,
        }
      );

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.httpStatusCode).toBe(403);

      const connection = await prisma.integrationConnection.findUnique({
        where: { id: testConnectionId },
      });
      expect(connection?.status).toBe(IntegrationConnectionStatus.ERROR);
    }, 15000);

    it("should honor retryAfterSeconds when rate-limited rather than computed exponential backoff", async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);

      const payload = {
        to: "customer@aforden.test",
        subject: "Rate Limit Probe",
        body: "Probe",
        simulateRateLimit: true,
        retryAfterSeconds: 6, // 6 seconds
      };

      const result = await executeCapabilityWithRetry(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload,
        {
          maxAttempts: 2,
          dbClient: prisma,
          sleepFn: sleepSpy,
        }
      );

      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.RATE_LIMITED);
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).toHaveBeenCalledWith(6000); // Exactly 6,000ms
    }, 15000);

    it("should propagate existing caller correlationId across all retry attempt ledger records", async () => {
      const flakyAdapter = new FlakyMockEmailAdapter("resend", 3);
      AdapterRegistry.registerAdapter(flakyAdapter, { allowOverride: true });

      const customCorrelationId = `corr_custom_${crypto.randomUUID()}`;
      const sleepSpy = vi.fn().mockResolvedValue(undefined);

      const payload = {
        to: "customer@aforden.test",
        subject: "Correlated Trace Dispatch",
        body: "Trace body",
      };

      await executeCapabilityWithRetry(
        testWorkspaceId,
        IntegrationCapability.EMAIL_SEND,
        "send_email",
        payload,
        {
          maxAttempts: 3,
          correlationId: customCorrelationId,
          dbClient: prisma,
          sleepFn: sleepSpy,
        }
      );

      const executions = await prisma.integrationExecution.findMany({
        where: {
          workspaceId: testWorkspaceId,
          connectionId: testConnectionId,
          action: "send_email",
        },
        orderBy: { attemptNumber: "asc" },
      });

      expect(executions.length).toBe(3);
      expect(executions.every((e) => e.correlationId === customCorrelationId)).toBe(true);
      expect(executions.every((e) => e.idempotencyKey === executions[0].idempotencyKey)).toBe(true);
    }, 15000);
  });
});
