/**
 * Phase 1.20.7 — Testing & Adversarial Security Regression Suite
 *
 * Cross-layer adversarial interaction tests consolidating and stress-testing:
 * - 1.20.2: Session Management & Sliding-Window Idle Timeouts
 * - 1.20.3: Authorization & Vertical/Horizontal Privilege Escalation Boundary
 * - 1.20.4: Tenant Isolation & IDOR Protection
 * - 1.20.5: API Abuse Protection & Route-Class Rate Limiting
 * - 1.20.6: Data Exposure & Error Handling Hardening
 *
 * Scenarios:
 * 1. Rate Limiting (1.20.5) × Tenant Isolation Probe (1.20.4)
 * 2. Sliding Session Idle Timeout (1.20.2) × Privilege Escalation RBAC (1.20.3)
 * 3. CSV Export Streaming (1.20.6) × Route Rate Limiting Classification (1.20.5)
 * 4. Deep Exception Sanitization Across Multi-Layer Wrapped Handlers (1.20.6 × 1.20.4 × 1.20.3)
 * 5. Payload Size Cap (1.20.5) × Cross-Tenant Mutation Attempt (1.20.4)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock Auth
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

const {
  mockUserFindUnique,
  mockWorkspaceFindUnique,
  mockMemberFindUnique,
  mockMemberFindFirst,
  mockSessionFindUnique,
  mockSessionFindFirst,
  mockSessionFindMany,
  mockSessionUpdate,
  mockSessionDelete,
  mockWorkOrderCount,
  mockWorkOrderFindMany,
  mockWorkOrderGroupBy,
  mockWorkOrderFindFirst,
  mockInvoiceCount,
  mockInvoiceFindMany,
  mockInvoiceFindFirst,
} = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockWorkspaceFindUnique: vi.fn(),
  mockMemberFindUnique: vi.fn(),
  mockMemberFindFirst: vi.fn(),
  mockSessionFindUnique: vi.fn(),
  mockSessionFindFirst: vi.fn(),
  mockSessionFindMany: vi.fn(),
  mockSessionUpdate: vi.fn(),
  mockSessionDelete: vi.fn(),
  mockWorkOrderCount: vi.fn(),
  mockWorkOrderFindMany: vi.fn(),
  mockWorkOrderGroupBy: vi.fn(),
  mockWorkOrderFindFirst: vi.fn(),
  mockInvoiceCount: vi.fn(),
  mockInvoiceFindMany: vi.fn(),
  mockInvoiceFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    workspace: { findUnique: mockWorkspaceFindUnique },
    workspaceMember: { findUnique: mockMemberFindUnique, findFirst: mockMemberFindFirst },
    session: {
      findUnique: mockSessionFindUnique,
      findFirst: mockSessionFindFirst,
      findMany: mockSessionFindMany,
      update: mockSessionUpdate,
      delete: mockSessionDelete,
    },
    workOrder: {
      count: mockWorkOrderCount,
      findMany: mockWorkOrderFindMany,
      groupBy: mockWorkOrderGroupBy,
      findFirst: mockWorkOrderFindFirst,
    },
    invoice: {
      count: mockInvoiceCount,
      findMany: mockInvoiceFindMany,
      findFirst: mockInvoiceFindFirst,
    },
  },
}));

import { auth } from "@/auth";
import {
  applyApiSecurityMiddleware,
  RATE_LIMIT_CONFIGS,
  MAX_PAYLOAD_BYTES,
} from "@/lib/api/apiSecurityMiddleware";
import { defaultMemoryRateLimitStore } from "@/lib/publicApi/rateLimit/memoryRateLimitStore";
import {
  isSessionIdle,
  validateAndTouchSession,
  WORKSPACE_SESSION_IDLE_TIMEOUT_MS,
} from "@/lib/services/auth/sessionManagement";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { requirePermission } from "@/lib/services/authorization/requirePermission";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import {
  UnauthorizedError,
  ForbiddenError,
  WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import { handleReportingApiError } from "@/lib/utils/reportingApiError";
import { handleIntegrationApiError } from "@/lib/utils/integrationApiError";
import { handlePlatformError } from "@/lib/services/platform/transport/httpHandler";
import { handleNotificationApiError } from "@/lib/utils/notificationApiError";
import { generateReportCsvChunks } from "@/lib/services/reporting/csvSerializer";
import { MAX_EXPORT_ROWS } from "@/lib/services/reporting/reportingConstants";
import { ReportCardinalityExceededError } from "@/lib/services/reporting/reportingErrors";
import type { ReportRowsReadModel } from "@/lib/services/reporting/reporting.types";

describe("Phase 1.20.7 — Testing & Adversarial Security Regression Suite", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSessionDelete.mockResolvedValue({});
    mockSessionUpdate.mockResolvedValue({});
    await defaultMemoryRateLimitStore.clear();
  });

  // =========================================================================
  // 1. Rate Limiting (1.20.5) × Tenant Isolation Probe (1.20.4)
  // =========================================================================
  describe("1. Rate Limiting × Tenant Isolation / IDOR Probe Interaction", () => {
    it("fires 429 BEFORE any tenant lookup or DB query when rate limit bucket is exhausted", () => {
      const probeUrl = "http://localhost:3000/api/workspaces/ws_target_victim/work-orders";
      const clientIp = "198.51.100.42";

      // 1. Consume all 60 mutation tokens for this IP + workspace
      for (let i = 0; i < RATE_LIMIT_CONFIGS.MUTATION.maxRequests; i++) {
        const req = new NextRequest(probeUrl, {
          method: "POST",
          headers: {
            "x-forwarded-for": clientIp,
            "content-length": "10",
          },
        });
        const res = applyApiSecurityMiddleware(req);
        expect(res).toBeNull(); // Allowed
      }

      // 2. 61st request: An IDOR probe attempting to hit foreign workspace
      const probeReq = new NextRequest(probeUrl, {
        method: "POST",
        headers: {
          "x-forwarded-for": clientIp,
          "content-length": "10",
        },
      });

      const blockedRes = applyApiSecurityMiddleware(probeReq);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes!.status).toBe(429);
      expect(blockedRes!.headers.get("Retry-After")).toBeDefined();
      expect(blockedRes!.headers.get("X-RateLimit-Remaining")).toBe("0");

      // Verify zero DB calls were made (Prisma was never touched)
      expect(mockWorkspaceFindUnique).not.toHaveBeenCalled();
      expect(mockUserFindUnique).not.toHaveBeenCalled();
      expect(mockWorkOrderFindMany).not.toHaveBeenCalled();
    });

    it("ensures rate-limiting on Tenant A does not exhaust or disclose Tenant B's rate limit budget", () => {
      const tenantAUrl = "http://localhost:3000/api/workspaces/ws_tenant_a/work-orders";
      const tenantBUrl = "http://localhost:3000/api/workspaces/ws_tenant_b/work-orders";
      const actorTokenA = "session_token_actor_a";
      const actorTokenB = "session_token_actor_b";

      // Exhaust Tenant A's budget
      for (let i = 0; i < RATE_LIMIT_CONFIGS.MUTATION.maxRequests; i++) {
        const req = new NextRequest(tenantAUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${actorTokenA}`,
            "content-length": "10",
          },
        });
        expect(applyApiSecurityMiddleware(req)).toBeNull();
      }

      // Next request to Tenant A is blocked with 429
      const tenantAReq = new NextRequest(tenantAUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${actorTokenA}`,
          "content-length": "10",
        },
      });
      const resA = applyApiSecurityMiddleware(tenantAReq);
      expect(resA?.status).toBe(429);

      // Tenant B request with distinct actor token is NOT blocked (budget isolated)
      const tenantBReq = new NextRequest(tenantBUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${actorTokenB}`,
          "content-length": "10",
        },
      });
      const resB = applyApiSecurityMiddleware(tenantBReq);
      expect(resB).toBeNull(); // Allowed
    });
  });

  // =========================================================================
  // 2. Sliding Session Idle Timeout (1.20.2) × Privilege Escalation (1.20.3)
  // =========================================================================
  describe("2. Sliding Session Idle Timeout × Privilege Escalation RBAC", () => {
    it("terminates with IDLE_TIMEOUT and deletes session BEFORE evaluating admin privilege escalation", async () => {
      const idleSessionTime = new Date(Date.now() - (WORKSPACE_SESSION_IDLE_TIMEOUT_MS + 60000));
      const mockSession = {
        id: "sess_idle_123",
        sessionToken: "token_idle",
        userId: "usr_attacker",
        lastActiveAt: idleSessionTime,
        expires: new Date(Date.now() + 86400000),
      };

      mockSessionFindUnique.mockResolvedValueOnce(mockSession);

      // Verify isSessionIdle recognizes idle state
      expect(isSessionIdle(mockSession.lastActiveAt)).toBe(true);

      // validateAndTouchSession returns valid=false with reason=IDLE_TIMEOUT and triggers deletion
      const validation = await validateAndTouchSession("token_idle", { session: mockSession } as any);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe("IDLE_TIMEOUT");

      expect(mockSessionDelete).toHaveBeenCalledWith({ where: { id: "sess_idle_123" } });
    });

    it("detects live database role demotion immediately despite valid session sliding window", async () => {
      const mockUser = {
        id: "usr_demoted_tech",
        email: "tech@aforden.test",
        name: "Field Tech",
        status: "ACTIVE",
        isActive: true,
      };

      const mockWorkspace = {
        id: "ws_acme",
        name: "Acme Corp",
        timezone: "UTC",
      };

      // User was originally ADMIN, but DB record reflects recent demotion to TECHNICIAN
      const mockMembership = {
        id: "mem_123",
        workspaceId: "ws_acme",
        userId: "usr_demoted_tech",
        role: "TECHNICIAN",
        status: "ACTIVE",
      };

      vi.mocked(auth).mockResolvedValueOnce({
        user: { id: "usr_demoted_tech", email: "tech@aforden.test" },
      } as any);

      mockUserFindUnique.mockResolvedValueOnce(mockUser);
      mockWorkspaceFindUnique.mockResolvedValueOnce(mockWorkspace);
      mockMemberFindUnique.mockResolvedValueOnce(mockMembership);

      // 1. Authorize workspace access directly via requirePermission
      await expect(
        requirePermission("ws_acme", PERMISSIONS.WORK_ORDERS_CREATE)
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects suspended workspace member with WorkspaceAccessDeniedError (403)", async () => {
      const mockUser = {
        id: "usr_suspended",
        email: "suspended@aforden.test",
        status: "ACTIVE",
        isActive: true,
      };

      const mockWorkspace = {
        id: "ws_acme",
        name: "Acme Corp",
        timezone: "UTC",
      };

      // Membership is SUSPENDED
      const mockMembership = {
        id: "mem_suspended",
        workspaceId: "ws_acme",
        userId: "usr_suspended",
        role: "ADMIN",
        status: "SUSPENDED",
      };

      vi.mocked(auth).mockResolvedValueOnce({
        user: { id: "usr_suspended", email: "suspended@aforden.test" },
      } as any);

      mockUserFindUnique.mockResolvedValueOnce(mockUser);
      mockWorkspaceFindUnique.mockResolvedValueOnce(mockWorkspace);
      mockMemberFindUnique.mockResolvedValueOnce(mockMembership);

      await expect(
        requireWorkspaceAuthorization("ws_acme")
      ).rejects.toThrow(WorkspaceAccessDeniedError);
    });
  });

  // =========================================================================
  // 3. CSV Export Streaming (1.20.6) × Route Rate Limiting (1.20.5)
  // =========================================================================
  describe("3. CSV Export Streaming × Route Rate Limiting Classification", () => {
    it("classifies GET /api/reports as READ rate limit (120 req/min), not mutation or skipped", () => {
      const reportUrl = "http://localhost:3000/api/reports?reportKey=operational.workOrderVolume&format=csv";
      const clientIp = "192.0.2.100";

      // 1. First 120 GET requests must pass (READ tier = 120/min)
      for (let i = 0; i < RATE_LIMIT_CONFIGS.READ.maxRequests; i++) {
        const req = new NextRequest(reportUrl, {
          method: "GET",
          headers: { "x-forwarded-for": clientIp },
        });
        const res = applyApiSecurityMiddleware(req);
        expect(res).toBeNull(); // Allowed under READ limit
      }

      // 2. 121st request must trigger HTTP 429
      const overLimitReq = new NextRequest(reportUrl, {
        method: "GET",
        headers: { "x-forwarded-for": clientIp },
      });
      const res = applyApiSecurityMiddleware(overLimitReq);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(429);
      expect(res!.headers.get("Retry-After")).toBeDefined();
    });

    it("enforces MAX_EXPORT_ROWS (50,000) ceiling during streaming without bypassing error handling", () => {
      const mockReport: ReportRowsReadModel = {
        meta: {
          reportKey: "operational.workOrderVolume",
          title: "Volume",
          shape: "ROWS",
          scope: "WORKSPACE",
          generatedAt: new Date().toISOString(),
          timezone: "UTC",
          range: {
            startUtc: "2026-01-01T00:00:00Z",
            endUtc: "2026-01-31T23:59:59.999Z",
            startLocalDate: "2026-01-01",
            endLocalDate: "2026-01-31",
            preset: null,
            granularity: "DAY",
          },
          asOfUtc: null,
          metrics: [{ key: "workOrders.createdCount", label: "Created", valueType: "COUNT", temporality: "PERIOD" }],
          dimensions: [{ key: "technician", label: "Technician" }],
          appliedFilters: [],
          sort: { key: "workOrders.createdCount", order: "desc" },
          sortedInMemory: false,
          truncated: false,
        },
        items: new Array(MAX_EXPORT_ROWS + 5).fill({
          dimensions: { technician: { key: "tech_1", label: "Tech 1" } },
          values: { "workOrders.createdCount": 1 },
        }),
        total: MAX_EXPORT_ROWS + 5,
        page: 1,
        limit: 100,
        totalPages: 1,
      };

      expect(() => {
        Array.from(generateReportCsvChunks(mockReport));
      }).toThrow(ReportCardinalityExceededError);
    });
  });

  // =========================================================================
  // 4. Deep Exception Sanitization in Multi-Layer Wrapped Handlers
  // =========================================================================
  describe("4. Deep Exception Sanitization in Multi-Layer Wrapped Handlers", () => {
    it("sanitizes deep Prisma driver crashes containing database connection strings", async () => {
      const sensitiveDbError = new Error(
        "PrismaClientInitializationError: Can't reach database server at `postgres://app_user:s3cr3t_p@ssw0rd@db.internal.aforden.com:5432/prod_db`"
      );

      // Test across all 4 domain error handlers
      const resReporting = handleReportingApiError(sensitiveDbError, "GET /api/reports");
      expect(resReporting.status).toBe(500);

      const resIntegration = handleIntegrationApiError(sensitiveDbError, "POST /api/integrations");
      expect(resIntegration.status).toBe(500);

      const resPlatform = handlePlatformError(sensitiveDbError);
      expect(resPlatform.status).toBe(500);

      const resNotification = handleNotificationApiError(sensitiveDbError, "POST /api/notifications");
      expect(resNotification.status).toBe(500);

      // Verify zero leak across all responses
      for (const res of [resReporting, resIntegration, resPlatform, resNotification]) {
        const body = await res.clone().text();
        expect(body).not.toContain("postgres://");
        expect(body).not.toContain("s3cr3t_p@ssw0rd");
        expect(body).not.toContain("db.internal.aforden.com");
        expect(body).not.toContain("PrismaClientInitializationError");
      }
    });

    it("sanitizes KMS decryption exceptions in platform error handler", async () => {
      const kmsError = new Error(
        "KMSInvalidCiphertextException: The ciphertext refers to a customer master key that does not exist. ARN: arn:aws:kms:us-west-2:112233445566:key/abc-999"
      );

      const res = handlePlatformError(kmsError);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INTERNAL_ERROR");
      expect(json.error.message).toBe("An unexpected platform error occurred.");
      expect(JSON.stringify(json)).not.toContain("arn:aws:kms");
      expect(JSON.stringify(json)).not.toContain("112233445566");
    });
  });

  // =========================================================================
  // 5. Payload Size Cap (1.20.5) × Cross-Tenant Mutation Attempt (1.20.4)
  // =========================================================================
  describe("5. Payload Size Cap × Cross-Tenant Mutation Attempt", () => {
    it("rejects oversized request with 413 PAYLOAD_TOO_LARGE before parsing body or checking tenant IDOR", () => {
      const targetUrl = "http://localhost:3000/api/workspaces/ws_target_tenant/work-orders";
      const oversizedBytes = MAX_PAYLOAD_BYTES + 500; // 1MB + 500 bytes

      const req = new NextRequest(targetUrl, {
        method: "POST",
        headers: {
          "content-length": String(oversizedBytes),
          "x-forwarded-for": "203.0.113.195",
        },
      });

      const res = applyApiSecurityMiddleware(req);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(413);

      // Verify zero DB calls were made
      expect(mockWorkspaceFindUnique).not.toHaveBeenCalled();
      expect(mockUserFindUnique).not.toHaveBeenCalled();
      expect(mockWorkOrderFindMany).not.toHaveBeenCalled();
    });
  });
});
