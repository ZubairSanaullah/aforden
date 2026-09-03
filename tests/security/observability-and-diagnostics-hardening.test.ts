/**
 * Phase 1.20.11 — Observability, Diagnostics & Health-Check Hardening Suite
 *
 * Mechanically asserts:
 * 1. Public Infrastructure Health Probe (/api/health) response codes, security headers, and failure behavior.
 * 2. Platform Operations Master Health Telemetry (/api/platform/health) authorization and data sanitization.
 * 3. Asynchronous Queue & Outbox Health Telemetry (/api/platform/health/queues).
 * 4. In-Memory Rate Limiter Health & Diagnostics (/api/platform/health/rate-limiter).
 * 5. Workspace Support Diagnostics (/api/platform/workspaces/:workspaceId/support) audit and redaction.
 * 6. Public API Connectivity Probe (/api/v1/ping) scope authorization.
 * 7. Provider Connection Health Verification (/api/integrations/:integrationId/test).
 * 8. Dead Letter Queue Diagnostics (/api/automations/dlq).
 * 9. Diagnostic Logging & Error Sanitization (zero credential or connection string leakage).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

import { GET as publicHealthGet } from "@/app/api/health/route";
import { GET as platformHealthGet } from "@/app/api/platform/health/route";
import { GET as platformQueuesGet } from "@/app/api/platform/health/queues/route";
import { GET as platformRateLimiterGet } from "@/app/api/platform/health/rate-limiter/route";
import { GET as platformSupportGet } from "@/app/api/platform/workspaces/[workspaceId]/support/route";
import { GET as publicPingGet } from "@/app/api/v1/ping/route";
import { POST as integrationTestPost } from "@/app/api/integrations/[integrationId]/test/route";
import { GET as automationsDlqGet } from "@/app/api/automations/dlq/route";

import { prisma } from "@/lib/prisma";
import {
  getPlatformSystemHealthSummary,
  getPlatformDatabaseHealth,
  getPlatformQueueHealth,
  getPlatformRateLimiterBlockerStatus,
} from "@/lib/services/platform/health";
import { PlatformAuthorizationContext } from "@/lib/services/platform/authorization";
import { sanitizePayload, maskCredentialSummary } from "@/lib/utils/integrationApiError";
import * as authService from "@/lib/publicApi/auth";

const mockAdminContext: PlatformAuthorizationContext = {
  userId: "usr_platform_admin_1",
  email: "admin@aforden.com",
  name: "Admin User",
  avatarUrl: null,
  platformRole: "PLATFORM_ADMIN" as any,
  profileId: "prof_1",
  status: "ACTIVE" as any,
  lastActiveAt: new Date(),
  lastLoginAt: new Date(),
  stepUpConfirmedAt: new Date(),
  metadata: null,
};

describe("Phase 1.20.11 — Observability, Diagnostics & Health-Check Hardening", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Public Infrastructure Health Probe (/api/health)
  // =========================================================================
  describe("1. Public Infrastructure Health Probe (/api/health)", () => {
    it("returns HTTP 200 with healthy status and timestamp when database is responsive", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ "?column?": 1 }] as any);

      const res = await publicHealthGet();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("healthy");
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();

      // Zero internal leakage
      expect(body).not.toHaveProperty("databaseUrl");
      expect(body).not.toHaveProperty("connectionString");
      expect(body).not.toHaveProperty("version");
    });

    it("attaches canonical security headers and no-store cache-control", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ "?column?": 1 }] as any);

      const res = await publicHealthGet();
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("content-security-policy")).toBeDefined();
    });

    it("returns HTTP 503 with sanitized error message when database connection fails", async () => {
      vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(
        new Error("FATAL: connection to postgres://admin:super_secret_pw@db.internal:5432 failed")
      );

      const res = await publicHealthGet();
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.status).toBe("unhealthy");
      expect(body.error).toContain("Service unavailable");

      // Critical: Verifies raw connection string / secret is NEVER reflected in response
      const rawText = JSON.stringify(body);
      expect(rawText).not.toContain("super_secret_pw");
      expect(rawText).not.toContain("postgres://");
      expect(rawText).not.toContain("db.internal");
    });
  });

  // =========================================================================
  // 2. Platform Operations Master Health Telemetry (/api/platform/health)
  // =========================================================================
  describe("2. Platform Operations Master Health Telemetry (/api/platform/health)", () => {
    it("rejects unauthenticated requests with HTTP 401 UNAUTHORIZED", async () => {
      const req = new Request("http://localhost:3000/api/platform/health");
      const res = await platformHealthGet(req as any, {} as any);
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("computes accurate system health summary without exposing sensitive credentials", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ "?column?": 1 }] as any);
      vi.spyOn(prisma.notificationOutbox, "count").mockResolvedValue(0);
      vi.spyOn(prisma.automationExecution, "count").mockResolvedValue(0);
      vi.spyOn(prisma.automationScheduleJob, "count").mockResolvedValue(0);
      vi.spyOn(prisma.webhookDelivery, "count").mockResolvedValue(0);
      vi.spyOn(prisma.billingWebhookEvent, "count").mockResolvedValue(0);
      vi.spyOn(prisma.integrationExecution, "count").mockResolvedValue(0);
      vi.spyOn(prisma.integrationWebhookEvent, "count").mockResolvedValue(0);
      vi.spyOn(prisma.platformBillingAccount, "count").mockResolvedValue(0);
      vi.spyOn(prisma.subscription, "count").mockResolvedValue(0);
      vi.spyOn(prisma.platformAuditLog, "count").mockResolvedValue(10);
      vi.spyOn(prisma.platformRuntimeSetting, "count").mockResolvedValue(5);
      vi.spyOn(prisma.platformFeatureFlag, "count").mockResolvedValue(3);

      const summary = await getPlatformSystemHealthSummary(mockAdminContext);
      expect(summary.status).toBe("DEGRADED"); // Degraded due to single-instance in-memory rate limiter blocker
      expect(summary.subsystems.database.status).toBe("HEALTHY");
      expect(summary.subsystems.queues.status).toBe("HEALTHY");
      expect(summary.subsystems.integrations.status).toBe("HEALTHY");
      expect(summary.subsystems.billing.status).toBe("HEALTHY");
      expect(summary.subsystems.rateLimiterBlocker.status).toBe("DEGRADED");
      expect(summary.subsystems.rateLimiterBlocker.blockerCode).toBe("PHASE_1_18_IN_MEMORY_RATE_LIMITER");
      expect(summary.subsystems.audit.status).toBe("HEALTHY");

      const serialized = JSON.stringify(summary);
      expect(serialized).not.toContain("password");
      expect(serialized).not.toContain("clientSecret");
      expect(serialized).not.toContain("DATABASE_URL");
    });

    it("accurately reports UNHEALTHY when database connectivity is degraded or failed", async () => {
      vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("Connection refused"));

      const dbHealth = await getPlatformDatabaseHealth(mockAdminContext);
      expect(dbHealth.status).toBe("UNHEALTHY");
      expect(dbHealth.connectionPool.isResponsive).toBe(false);
      expect(dbHealth.latencyMs).toBe(-1);
    });
  });

  // =========================================================================
  // 3. Queue Health Telemetry Endpoint (/api/platform/health/queues)
  // =========================================================================
  describe("3. Queue Health Telemetry Endpoint (/api/platform/health/queues)", () => {
    it("rejects unauthenticated caller with HTTP 401 UNAUTHORIZED", async () => {
      const req = new Request("http://localhost:3000/api/platform/health/queues");
      const res = await platformQueuesGet(req as any, {} as any);
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("returns queue health telemetry with zero customer payload leakage", async () => {
      vi.spyOn(prisma.notificationOutbox, "count").mockResolvedValue(0);
      vi.spyOn(prisma.automationExecution, "count").mockResolvedValue(0);
      vi.spyOn(prisma.automationScheduleJob, "count").mockResolvedValue(0);
      vi.spyOn(prisma.webhookDelivery, "count").mockResolvedValue(0);
      vi.spyOn(prisma.billingWebhookEvent, "count").mockResolvedValue(0);

      const queueHealth = await getPlatformQueueHealth(mockAdminContext);
      expect(queueHealth.status).toBe("HEALTHY");
      expect(queueHealth.notificationOutbox.pending).toBe(0);
      expect(queueHealth.automationExecutions.failed).toBe(0);

      const serialized = JSON.stringify(queueHealth);
      expect(serialized).not.toContain("payload");
      expect(serialized).not.toContain("recipientEmail");
    });
  });

  // =========================================================================
  // 4. Rate Limiter Health & Blocker Diagnostics (/api/platform/health/rate-limiter)
  // =========================================================================
  describe("4. Rate Limiter Health & Blocker Diagnostics (/api/platform/health/rate-limiter)", () => {
    it("rejects unauthenticated caller with HTTP 401 UNAUTHORIZED", async () => {
      const req = new Request("http://localhost:3000/api/platform/health/rate-limiter");
      const res = await platformRateLimiterGet(req as any, {} as any);
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("surfaces in-memory rate limiter blocker code and multi-instance risk", async () => {
      const blocker = await getPlatformRateLimiterBlockerStatus(mockAdminContext);
      expect(blocker.status).toBe("DEGRADED");
      expect(blocker.isInMemoryStore).toBe(true);
      expect(blocker.isDistributed).toBe(false);
      expect(blocker.blockerCode).toBe("PHASE_1_18_IN_MEMORY_RATE_LIMITER");
      expect(blocker.multiInstanceRisk).toBe("HIGH");
      expect(blocker.activeStoreName).toBe("MemoryRateLimitStore");
    });
  });

  // =========================================================================
  // 5. Workspace Support Diagnostics (/api/platform/workspaces/[workspaceId]/support)
  // =========================================================================
  describe("5. Workspace Support Diagnostics (/api/platform/workspaces/:workspaceId/support)", () => {
    it("rejects unauthenticated caller with HTTP 401 UNAUTHORIZED", async () => {
      const req = new Request("http://localhost:3000/api/platform/workspaces/ws_123/support");
      const res = await platformSupportGet(req as any, { params: Promise.resolve({ workspaceId: "ws_123" }) } as any);
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("returns HTTP 404 with standard error envelope when workspace does not exist", async () => {
      const { getWorkspaceSupportDiagnostics } = await import("@/lib/services/platform/support");
      vi.spyOn(prisma.platformAuditLog, "create").mockResolvedValueOnce({ id: "audit_1" } as any);
      vi.spyOn(prisma.workspace, "findUnique").mockResolvedValueOnce(null);

      await expect(
        getWorkspaceSupportDiagnostics(mockAdminContext, "ws_nonexistent", {})
      ).rejects.toThrow("Workspace 'ws_nonexistent' was not found");
    });
  });

  // =========================================================================
  // 6. Public API Connectivity Probe (/api/v1/ping)
  // =========================================================================
  describe("6. Public API Connectivity Probe (/api/v1/ping)", () => {
    it("rejects unauthenticated request lacking Authorization header with HTTP 401", async () => {
      const req = new Request("http://localhost:3000/api/v1/ping");
      const res = await publicPingGet(req);
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toContain("Invalid or missing API key.");
    });

    it("rejects invalid API key with HTTP 401 UNAUTHORIZED", async () => {
      vi.spyOn(prisma.apiKey, "findFirst").mockResolvedValueOnce(null);

      const req = new Request("http://localhost:3000/api/v1/ping", {
        headers: { authorization: "Bearer invalid_api_key_test_9999" },
      });
      const res = await publicPingGet(req);
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toContain("Invalid or missing API key.");
    });

    it("returns HTTP 200 with application details when authenticated with valid ping:read scope", async () => {
      vi.spyOn(authService, "authenticatePublicApiRequest").mockResolvedValueOnce({
        apiKeyId: "key_test_123",
        developerApplicationId: "app_test_123",
        developerApplicationName: "Telemetry Probe Test",
        workspaceId: "ws_test_123",
        environment: "TEST" as any,
        scopes: ["ping:read"],
      });
      vi.spyOn(prisma.apiRequestLog, "create").mockResolvedValueOnce({
        id: "log_1",
        workspaceId: "ws_test_123",
        apiKeyId: "key_test_123",
        developerApplicationId: "app_test_123",
        requestId: "req_123",
        endpoint: "/api/v1/ping",
        httpMethod: "GET",
        ipHash: "hash123",
        statusCode: 200,
        responseTimeMs: 5,
        rateLimited: false,
        rateLimitTier: "STANDARD",
        requestHeaders: {},
        requestPayload: null,
        responsePayload: null,
        errorMessage: null,
        createdAt: new Date(),
      } as any);

      const req = new Request("http://localhost:3000/api/v1/ping", {
        headers: { authorization: "Bearer afd_live_valid1234567890123456" },
      });
      const res = await publicPingGet(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("ok");
      expect(body.data.message).toBe("Aforden Public API v1 is operational");
      expect(body.data.application).toBe("Telemetry Probe Test");
    });
  });

  // =========================================================================
  // 7. Provider Connection Health Verification (/api/integrations/[integrationId]/test)
  // =========================================================================
  describe("7. Provider Connection Health Verification (/api/integrations/:integrationId/test)", () => {
    it("rejects missing workspace context with HTTP 400 MISSING_WORKSPACE", async () => {
      const req = new Request("http://localhost:3000/api/integrations/int_quickbooks/test", {
        method: "POST",
      });
      const res = await integrationTestPost(req, {
        params: Promise.resolve({ integrationId: "int_quickbooks" }),
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error.code).toBe("MISSING_WORKSPACE");
    });

    it("rejects unauthenticated caller with HTTP 401 UNAUTHORIZED", async () => {
      const req = new Request("http://localhost:3000/api/integrations/int_quickbooks/test?workspaceId=ws_123", {
        method: "POST",
      });
      const res = await integrationTestPost(req, {
        params: Promise.resolve({ integrationId: "int_quickbooks" }),
      });
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  // =========================================================================
  // 8. Dead Letter Queue Diagnostics (/api/automations/dlq)
  // =========================================================================
  describe("8. Dead Letter Queue Diagnostics (/api/automations/dlq)", () => {
    it("rejects missing workspace context with HTTP 400 MISSING_WORKSPACE", async () => {
      const req = new Request("http://localhost:3000/api/automations/dlq");
      const res = await automationsDlqGet(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error.code).toBe("MISSING_WORKSPACE");
    });

    it("rejects unauthenticated caller with HTTP 401 UNAUTHORIZED", async () => {
      const req = new Request("http://localhost:3000/api/automations/dlq?workspaceId=ws_123");
      const res = await automationsDlqGet(req);
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  // =========================================================================
  // 9. Diagnostic Logging & Error Redaction Guarantees
  // =========================================================================
  describe("9. Diagnostic Logging & Error Redaction Guarantees", () => {
    it("sanitizes payloads removing Stripe secrets, tokens, and authorization headers", () => {
      const diagnosticTelemetry = {
        endpoint: "/api/v1/work-orders",
        method: "POST",
        headers: {
          authorization: "Bearer aforden_live_supersecrettoken12345",
          "x-api-key": "ak_live_998877665544332211",
        },
        payload: {
          customerName: "Acme Corp",
          stripeSecret: "sk_live_stripe_secret_key_abcdef",
          refreshToken: "rt_oauth_secret_refresh_token_xyz",
        },
      };

      const sanitized = sanitizePayload(diagnosticTelemetry) as any;

      expect(sanitized.headers.authorization).toBe("[REDACTED]");
      expect(sanitized.headers["x-api-key"]).toBe("[REDACTED]");
      expect(sanitized.payload.stripeSecret).toBe("[REDACTED]");
      expect(sanitized.payload.refreshToken).toBe("[REDACTED]");
      expect(sanitized.payload.customerName).toBe("Acme Corp"); // Non-sensitive data preserved
    });

    it("maskCredentialSummary strips all cryptographic cipher fields from diagnostic DTOs", () => {
      const rawCredential = {
        id: "cred_123",
        connectionId: "conn_456",
        version: 1,
        status: "ACTIVE",
        algorithm: "AES_256_GCM",
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        fingerprint: "sha256:abcd1234efgh5678",
        encryptedData: "8f3a9e...raw_ciphertext...",
        iv: "1234567890abcdef12345678",
        tag: "abcdef1234567890abcdef1234567890",
        encryptedDek: "secret_dek_wrapper",
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const masked = maskCredentialSummary(rawCredential);

      expect(masked.id).toBe("cred_123");
      expect(masked.fingerprint).toBe("sha256:abcd1234efgh5678");

      // Ciphertext, IV, Auth Tag, and DEK must NEVER be present in diagnostic summary
      expect(masked).not.toHaveProperty("encryptedData");
      expect(masked).not.toHaveProperty("iv");
      expect(masked).not.toHaveProperty("tag");
      expect(masked).not.toHaveProperty("encryptedDek");
    });
  });
});
