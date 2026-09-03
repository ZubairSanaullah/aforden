import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        platformAdminProfile: { update: vi.fn() },
        platformAuditLog: { create: vi.fn() },
        workspace: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
        platformFeatureFlag: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
        $transaction: vi.fn(),
    },
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: mocks.prisma,
}));

import {
    PlatformRole,
    PlatformAdminStatus,
} from "@/lib/services/platform/authorization";

// Route Handlers
import { GET as getMeRoute } from "@/app/api/platform/me/route";
import { GET as getWorkspacesRoute } from "@/app/api/platform/workspaces/route";
import { GET as getWorkspaceDetailRoute } from "@/app/api/platform/workspaces/[workspaceId]/route";
import { GET as getWorkspaceSupportRoute } from "@/app/api/platform/workspaces/[workspaceId]/support/route";
import { POST as suspendWorkspaceRoute } from "@/app/api/platform/workspaces/[workspaceId]/suspend/route";
import { GET as getFlagsRoute, POST as createFlagRoute } from "@/app/api/platform/flags/route";
import { GET as getOperatorsRoute, POST as createOperatorRoute } from "@/app/api/platform/operators/route";
import { GET as getHealthRoute } from "@/app/api/platform/health/route";
import { GET as getBillingAccountsRoute } from "@/app/api/platform/billing/accounts/route";

describe("Phase 1.21.3 — Platform Admin API HTTP Boundary Contract", () => {
    const ADMIN_USER_ID = "admin_user_contract_1";

    const mockSuperAdminUser = {
        id: ADMIN_USER_ID,
        name: "Platform Owner",
        email: "superadmin@aforden.internal",
        status: "ACTIVE",
        platformRole: PlatformRole.PLATFORM_OWNER,
        platformAdminProfile: {
            id: "profile_1",
            userId: ADMIN_USER_ID,
            status: PlatformAdminStatus.ACTIVE,
            lastActiveAt: new Date(),
            lastLoginAt: new Date(),
            stepUpConfirmedAt: new Date(),
            sessionTimeoutMinutes: 60,
        },
    };

    const mockSupportUser = {
        id: "support_user_1",
        name: "Platform Support",
        email: "support@aforden.internal",
        status: "ACTIVE",
        platformRole: PlatformRole.PLATFORM_SUPPORT,
        platformAdminProfile: {
            id: "profile_2",
            userId: "support_user_1",
            status: PlatformAdminStatus.ACTIVE,
            lastActiveAt: new Date(),
            lastLoginAt: new Date(),
            stepUpConfirmedAt: new Date(),
            sessionTimeoutMinutes: 60,
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.auth.mockResolvedValue({
            user: { id: ADMIN_USER_ID, email: "superadmin@aforden.internal" },
        });

        mocks.prisma.user.findUnique.mockResolvedValue(mockSuperAdminUser);
        mocks.prisma.platformAdminProfile.update.mockResolvedValue({ id: "profile_1" });
        mocks.prisma.platformAuditLog.create.mockResolvedValue({ id: "audit_1" });
        mocks.prisma.$transaction.mockImplementation(async (cb: any) => {
            if (typeof cb === "function") return cb(mocks.prisma);
            return Promise.all(cb);
        });
    });

    describe("1. Unauthenticated Caller Rejection (401 UNAUTHORIZED)", () => {
        it("GET /api/platform/me rejects unauthenticated request with 401", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = new NextRequest("http://localhost/api/platform/me");
            const res = await getMeRoute(req);
            expect(res.status).toBe(401);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("GET /api/platform/workspaces rejects unauthenticated request with 401", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = new NextRequest("http://localhost/api/platform/workspaces");
            const res = await getWorkspacesRoute(req);
            expect(res.status).toBe(401);
        });

        it("GET /api/platform/flags rejects unauthenticated request with 401", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = new NextRequest("http://localhost/api/platform/flags");
            const res = await getFlagsRoute(req);
            expect(res.status).toBe(401);
        });

        it("GET /api/platform/operators rejects unauthenticated request with 401", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = new NextRequest("http://localhost/api/platform/operators");
            const res = await getOperatorsRoute(req);
            expect(res.status).toBe(401);
        });

        it("GET /api/platform/health rejects unauthenticated request with 401", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = new NextRequest("http://localhost/api/platform/health");
            const res = await getHealthRoute(req);
            expect(res.status).toBe(401);
        });

        it("GET /api/platform/billing/accounts rejects unauthenticated request with 401", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = new NextRequest("http://localhost/api/platform/billing/accounts");
            const res = await getBillingAccountsRoute(req);
            expect(res.status).toBe(401);
        });
    });

    describe("2. RBAC & Privilege Boundary Rejections (403 FORBIDDEN)", () => {
        it("POST /api/platform/flags rejects PLATFORM_SUPPORT role attempting to mutate flags with 403", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: "support_user_1", email: "support@aforden.internal" },
            });
            mocks.prisma.user.findUnique.mockResolvedValue(mockSupportUser);

            const req = new NextRequest("http://localhost/api/platform/flags", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    key: "NEW_FEATURE",
                    name: "New Feature",
                    description: "Feature description",
                    type: "BOOLEAN",
                    defaultValue: false,
                }),
            });
            const res = await createFlagRoute(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("POST /api/platform/operators rejects PLATFORM_SUPPORT role attempting to create operators with 403", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: "support_user_1", email: "support@aforden.internal" },
            });
            mocks.prisma.user.findUnique.mockResolvedValue(mockSupportUser);

            const req = new NextRequest("http://localhost/api/platform/operators", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    email: "newop@aforden.internal",
                    role: "SUPPORT_TIER_1",
                }),
            });
            const res = await createOperatorRoute(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });
    });

    describe("3. Route Parameters & Resource 404 Boundaries", () => {
        it("GET /api/platform/workspaces/:workspaceId/support returns 404 for non-existent workspace", async () => {
            mocks.prisma.workspace.findUnique.mockResolvedValue(null);

            const req = new NextRequest("http://localhost/api/platform/workspaces/ws_nonexistent/support");
            const res = await getWorkspaceSupportRoute(req, {
                params: Promise.resolve({ workspaceId: "ws_nonexistent" }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("WORKSPACE_NOT_FOUND");
        });

        it("GET /api/platform/workspaces/:workspaceId returns 200 with null when workspace does not exist", async () => {
            mocks.prisma.workspace.findUnique.mockResolvedValue(null);

            const req = new NextRequest("http://localhost/api/platform/workspaces/ws_nonexistent");
            const res = await getWorkspaceDetailRoute(req, {
                params: Promise.resolve({ workspaceId: "ws_nonexistent" }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toBeNull();
        });
    });

    describe("4. Request Validation Boundaries & Schema Protection", () => {
        it("POST /api/platform/workspaces/:workspaceId/suspend returns 400 when reason is empty", async () => {
            const req = new NextRequest("http://localhost/api/platform/workspaces/ws_1/suspend", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ reason: "" }), // empty reason
            });
            const res = await suspendWorkspaceRoute(req, {
                params: Promise.resolve({ workspaceId: "ws_1" }),
            });
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INVALID_JUSTIFICATION_REASON");
        });

        it("POST /api/platform/flags returns 400 when key violates identifier constraints", async () => {
            const req = new NextRequest("http://localhost/api/platform/flags", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    key: "invalid key with spaces",
                    name: "Invalid Key Flag",
                    type: "BOOLEAN",
                    defaultValue: true,
                }),
            });
            const res = await createFlagRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INVALID_FEATURE_FLAG_INPUT");
        });
    });

    describe("5. End-to-End Success Envelopes & Serialization", () => {
        it("GET /api/platform/me returns 200 with authenticated admin profile payload", async () => {
            const req = new NextRequest("http://localhost/api/platform/me");
            const res = await getMeRoute(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.userId).toBe(ADMIN_USER_ID);
        });

        it("GET /api/platform/workspaces returns 200 with paginated workspaces", async () => {
            mocks.prisma.workspace.count.mockResolvedValue(1);
            mocks.prisma.workspace.findMany.mockResolvedValue([
                {
                    id: "ws_100",
                    name: "Acme HQ",
                    slug: "acme-hq",
                    status: "ACTIVE",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    members: [],
                    _count: { members: 1 },
                },
            ]);

            const req = new NextRequest("http://localhost/api/platform/workspaces?page=1&limit=25");
            const res = await getWorkspacesRoute(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.workspaces).toBeDefined();
        });
    });
});
