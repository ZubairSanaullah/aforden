import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// =========================================================================
// Mocks Setup
// =========================================================================

const { authMock, findUniqueUserMock, updateProfileMock, auditCreateMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
    findUniqueUserMock: vi.fn(),
    updateProfileMock: vi.fn(),
    auditCreateMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: findUniqueUserMock,
        },
        platformAdminProfile: {
            update: updateProfileMock,
        },
        platformAuditLog: {
            create: auditCreateMock,
        },
    },
}));

import {
    PlatformRole,
    PlatformAdminStatus,
} from "@/lib/services/platform/authorization";
import {
    jsonSuccess,
    jsonError,
    handlePlatformError,
    PlatformStepUpAuthenticationRequiredError,
} from "@/lib/services/platform/transport";

// Route Handlers (36 Files / 39 Endpoint Operations)
import { GET as getMe } from "@/app/api/platform/me/route";
import { GET as getMePermissions } from "@/app/api/platform/me/permissions/route";
import { GET as getRbacMatrix } from "@/app/api/platform/rbac/matrix/route";
import { GET as getAudit } from "@/app/api/platform/audit/route";
import { GET as getWorkspacesRoute } from "@/app/api/platform/workspaces/route";
import { GET as getWorkspaceDetailRoute } from "@/app/api/platform/workspaces/[workspaceId]/route";
import { POST as suspendWorkspaceRoute } from "@/app/api/platform/workspaces/[workspaceId]/suspend/route";
import { POST as reactivateWorkspaceRoute } from "@/app/api/platform/workspaces/[workspaceId]/reactivate/route";
import { GET as getWorkspaceSupportRoute } from "@/app/api/platform/workspaces/[workspaceId]/support/route";
import { GET as getOperatorsRoute, POST as createOperatorRoute } from "@/app/api/platform/operators/route";
import { PATCH as updateOperatorRoleRoute } from "@/app/api/platform/operators/[operatorId]/role/route";
import { DELETE as deactivateOperatorRoute } from "@/app/api/platform/operators/[operatorId]/route";
import { GET as getFlagsRoute, POST as createFlagRoute } from "@/app/api/platform/flags/route";
import { PATCH as updateFlagRoute, DELETE as deleteFlagRoute } from "@/app/api/platform/flags/[flagId]/route";
import { POST as toggleFlagRoute } from "@/app/api/platform/flags/[flagId]/toggle/route";
import { GET as getSettingsRoute } from "@/app/api/platform/settings/route";
import { PUT as upsertSettingRoute } from "@/app/api/platform/settings/[key]/route";
import { GET as getDeveloperAppsRoute } from "@/app/api/platform/developer/apps/route";
import { PATCH as updateDeveloperAppStatusRoute } from "@/app/api/platform/developer/apps/[appId]/status/route";
import { POST as revokeApiKeyRoute } from "@/app/api/platform/developer/keys/[keyId]/revoke/route";
import { POST as disableWebhookRoute } from "@/app/api/platform/developer/webhooks/[webhookId]/disable/route";
import { POST as resetRateLimitRoute } from "@/app/api/platform/developer/rate-limits/reset/route";
import { GET as getIntegrationsRoute } from "@/app/api/platform/integrations/route";
import { PATCH as updateConnectionStatusRoute } from "@/app/api/platform/integrations/connections/[connectionId]/status/route";
import { POST as revokeIntegrationCredentialRoute } from "@/app/api/platform/integrations/credentials/[credentialId]/revoke/route";
import { POST as testIntegrationConnectionRoute } from "@/app/api/platform/integrations/connections/[connectionId]/test/route";
import { GET as getBillingAccountsRoute } from "@/app/api/platform/billing/accounts/route";
import { GET as getBillingPlansRoute } from "@/app/api/platform/billing/plans/route";
import { POST as assignPlanRoute } from "@/app/api/platform/billing/workspaces/[workspaceId]/plan/route";
import { POST as overrideEntitlementRoute } from "@/app/api/platform/billing/workspaces/[workspaceId]/entitlements/route";
import { DELETE as removeEntitlementRoute } from "@/app/api/platform/billing/workspaces/[workspaceId]/entitlements/[featureKey]/route";
import { POST as syncBillingAccountRoute } from "@/app/api/platform/billing/workspaces/[workspaceId]/sync/route";
import { POST as replayBillingWebhookRoute } from "@/app/api/platform/billing/webhooks/[eventId]/replay/route";
import { GET as getHealthSummaryRoute } from "@/app/api/platform/health/route";
import { GET as getHealthQueuesRoute } from "@/app/api/platform/health/queues/route";
import { GET as getHealthRateLimiterRoute } from "@/app/api/platform/health/rate-limiter/route";

// Domain Services
import * as auditService from "@/lib/services/platform/audit";
import * as workspaceService from "@/lib/services/platform/workspaces";
import * as supportService from "@/lib/services/platform/support";
import * as operatorService from "@/lib/services/platform/operators";
import * as flagService from "@/lib/services/platform/flags";
import * as settingService from "@/lib/services/platform/settings";
import * as developerService from "@/lib/services/platform/developer";
import * as integrationService from "@/lib/services/platform/integrations";
import * as billingService from "@/lib/services/platform/billing";
import * as healthService from "@/lib/services/platform/health";

describe("Phase 1.19.16 — Platform Administrative API (Route Handlers) Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function mockAuthenticatedOperator(
        role: PlatformRole = PlatformRole.PLATFORM_OWNER,
        profileStatus: PlatformAdminStatus = PlatformAdminStatus.ACTIVE,
        lastActiveAt: Date = new Date()
    ) {
        authMock.mockResolvedValue({
            user: { id: "usr_platform_operator", email: "operator@aforden.com" },
        });

        findUniqueUserMock.mockResolvedValue({
            id: "usr_platform_operator",
            name: "Platform Operator",
            email: "operator@aforden.com",
            avatarUrl: null,
            status: "ACTIVE",
            platformRole: role,
            platformAdminProfile: {
                id: "prof_operator_1",
                status: profileStatus,
                lastActiveAt,
                lastLoginAt: new Date(),
                stepUpConfirmedAt: new Date(),
                metadata: null,
            },
        });
    }

    function mockUnauthenticated() {
        authMock.mockResolvedValue(null);
    }

    function createMockRequest(
        url: string,
        method: string = "GET",
        body?: unknown,
        headers?: Record<string, string>
    ): NextRequest {
        return new NextRequest(new URL(url, "https://platform.aforden.com"), {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(headers || {}),
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
    }

    // =========================================================================
    // 1. Centralized Error-to-HTTP Status Translation
    // =========================================================================
    describe("1. Centralized Error-to-HTTP Status Translation", () => {
        it("maps domain validation errors to HTTP 400 BAD_REQUEST", () => {
            const err = new workspaceService.PlatformActionValidationError("Reason must be 10+ characters.");
            const res = handlePlatformError(err);
            expect(res.status).toBe(400);
        });

        it("maps domain not found errors to HTTP 404 NOT_FOUND", () => {
            const err = new workspaceService.PlatformWorkspaceNotFoundError("ws_missing");
            const res = handlePlatformError(err);
            expect(res.status).toBe(404);
        });

        it("maps domain conflict errors to HTTP 409 CONFLICT", () => {
            const err = new workspaceService.PlatformWorkspaceConflictError("Workspace is already inactive.");
            const res = handlePlatformError(err);
            expect(res.status).toBe(409);
        });

        it("maps step-up authentication errors to HTTP 403 STEP_UP_REQUIRED", () => {
            const err = new PlatformStepUpAuthenticationRequiredError();
            const res = handlePlatformError(err);
            expect(res.status).toBe(403);
        });

        it("maps inactive operator error to HTTP 403 OPERATOR_INACTIVE", () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN, PlatformAdminStatus.SUSPENDED);
            const res = handlePlatformError(new operatorService.PlatformSelfModificationError());
            expect(res.status).toBe(403);
        });

        it("maps health check errors to HTTP 500 PLATFORM_HEALTH_ERROR", () => {
            const err = new healthService.PlatformHealthError("Database connection timed out.");
            const res = handlePlatformError(err);
            expect(res.status).toBe(500);
        });

        it("maps unexpected unhandled errors to HTTP 500 INTERNAL_ERROR without leaking raw details", async () => {
            const err = new Error("Database crashed unexpectedly");
            const res = handlePlatformError(err);
            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INTERNAL_ERROR");
        });
    });

    // =========================================================================
    // 2. Comprehensive Per-Route Success, 401 (Unauth), and 403 (Forbidden) Coverage
    // =========================================================================
    describe("2. Comprehensive Per-Route Coverage Across 39 Operations", () => {
        // --- 1. Identity & RBAC ---
        describe("1. Identity & RBAC Routes", () => {
            it("GET /api/platform/me: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                const res = await getMe(createMockRequest("/api/platform/me"));
                expect(res.status).toBe(200);
                const json = await res.json();
                expect(json.success).toBe(true);
                expect(json.data.userId).toBe("usr_platform_operator");
            });

            it("GET /api/platform/me: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getMe(createMockRequest("/api/platform/me"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/me: 403 forbidden when user has no platformRole", async () => {
                authMock.mockResolvedValue({ user: { id: "usr_tenant" } });
                findUniqueUserMock.mockResolvedValue({ id: "usr_tenant", platformRole: null });
                const res = await getMe(createMockRequest("/api/platform/me"));
                expect(res.status).toBe(403);
            });

            it("GET /api/platform/me/permissions: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OPERATIONS);
                const res = await getMePermissions(createMockRequest("/api/platform/me/permissions"));
                expect(res.status).toBe(200);
                const json = await res.json();
                expect(json.data.role).toBe(PlatformRole.PLATFORM_OPERATIONS);
            });

            it("GET /api/platform/me/permissions: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getMePermissions(createMockRequest("/api/platform/me/permissions"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/me/permissions: 403 forbidden for non-platform user", async () => {
                authMock.mockResolvedValue({ user: { id: "usr_tenant" } });
                findUniqueUserMock.mockResolvedValue({ id: "usr_tenant", platformRole: null });
                const res = await getMePermissions(createMockRequest("/api/platform/me/permissions"));
                expect(res.status).toBe(403);
            });

            it("GET /api/platform/rbac/matrix: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
                const res = await getRbacMatrix(createMockRequest("/api/platform/rbac/matrix"));
                expect(res.status).toBe(200);
                const json = await res.json();
                expect(json.data.matrix).toBeDefined();
            });

            it("GET /api/platform/rbac/matrix: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getRbacMatrix(createMockRequest("/api/platform/rbac/matrix"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/rbac/matrix: 403 forbidden when lacking OPERATORS_VIEW", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                const res = await getRbacMatrix(createMockRequest("/api/platform/rbac/matrix"));
                expect(res.status).toBe(403);
            });
        });

        // --- 2. Audit ---
        describe("2. Audit Log Route", () => {
            it("GET /api/platform/audit: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SECURITY);
                vi.spyOn(auditService, "queryPlatformAuditLog").mockResolvedValueOnce({ records: [], total: 0 });
                const res = await getAudit(createMockRequest("/api/platform/audit"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/audit: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getAudit(createMockRequest("/api/platform/audit"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/audit: 403 forbidden when lacking AUDIT_VIEW", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                const res = await getAudit(createMockRequest("/api/platform/audit"));
                expect(res.status).toBe(403);
            });
        });

        // --- 3. Workspaces & Support ---
        describe("3. Workspaces & Support Routes", () => {
            it("GET /api/platform/workspaces: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(workspaceService, "getWorkspaces").mockResolvedValueOnce({ workspaces: [], total: 0 });
                const res = await getWorkspacesRoute(createMockRequest("/api/platform/workspaces"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/workspaces: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getWorkspacesRoute(createMockRequest("/api/platform/workspaces"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/workspaces: 403 forbidden when operator is inactive", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN, PlatformAdminStatus.SUSPENDED);
                const res = await getWorkspacesRoute(createMockRequest("/api/platform/workspaces"));
                expect(res.status).toBe(403);
            });

            it("GET /api/platform/workspaces/[workspaceId]: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(workspaceService, "getWorkspace").mockResolvedValueOnce({ id: "ws_1" } as any);
                const res = await getWorkspaceDetailRoute(createMockRequest("/api/platform/workspaces/ws_1"), {
                    params: Promise.resolve({ workspaceId: "ws_1" }),
                });
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/workspaces/[workspaceId]: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getWorkspaceDetailRoute(createMockRequest("/api/platform/workspaces/ws_1"), {
                    params: Promise.resolve({ workspaceId: "ws_1" }),
                });
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/workspaces/[workspaceId]: 403 forbidden when operator is inactive", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN, PlatformAdminStatus.SUSPENDED);
                const res = await getWorkspaceDetailRoute(createMockRequest("/api/platform/workspaces/ws_1"), {
                    params: Promise.resolve({ workspaceId: "ws_1" }),
                });
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/workspaces/[workspaceId]/suspend: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
                vi.spyOn(workspaceService, "suspendWorkspace").mockResolvedValueOnce({ id: "ws_1" } as any);
                const res = await suspendWorkspaceRoute(
                    createMockRequest("/api/platform/workspaces/ws_1/suspend", "POST", { reason: "Terms violation." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/workspaces/[workspaceId]/suspend: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await suspendWorkspaceRoute(
                    createMockRequest("/api/platform/workspaces/ws_1/suspend", "POST", { reason: "Terms violation." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/workspaces/[workspaceId]/suspend: 403 forbidden when lacking WORKSPACES_SUSPEND", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await suspendWorkspaceRoute(
                    createMockRequest("/api/platform/workspaces/ws_1/suspend", "POST", { reason: "Terms violation." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/workspaces/[workspaceId]/reactivate: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
                vi.spyOn(workspaceService, "reactivateWorkspace").mockResolvedValueOnce({ id: "ws_1" } as any);
                const res = await reactivateWorkspaceRoute(
                    createMockRequest("/api/platform/workspaces/ws_1/reactivate", "POST", { reason: "Account reinstated." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/workspaces/[workspaceId]/reactivate: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await reactivateWorkspaceRoute(
                    createMockRequest("/api/platform/workspaces/ws_1/reactivate", "POST", { reason: "Account reinstated." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/workspaces/[workspaceId]/reactivate: 403 forbidden when lacking WORKSPACES_SUSPEND", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await reactivateWorkspaceRoute(
                    createMockRequest("/api/platform/workspaces/ws_1/reactivate", "POST", { reason: "Account reinstated." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("GET /api/platform/workspaces/[workspaceId]/support: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                vi.spyOn(supportService, "getWorkspaceSupportDiagnostics").mockResolvedValueOnce({ workspace: { id: "ws_1" } } as any);
                const res = await getWorkspaceSupportRoute(
                    createMockRequest("/api/platform/workspaces/ws_1/support?ticketReference=TCK-1"),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/workspaces/[workspaceId]/support: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getWorkspaceSupportRoute(
                    createMockRequest("/api/platform/workspaces/ws_1/support?ticketReference=TCK-1"),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/workspaces/[workspaceId]/support: 403 forbidden when lacking WORKSPACES_SUPPORT_VIEW", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                const res = await getWorkspaceSupportRoute(
                    createMockRequest("/api/platform/workspaces/ws_1/support?ticketReference=TCK-1"),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(403);
            });
        });

        // --- 4. Operators ---
        describe("4. Operator Management Routes", () => {
            it("GET /api/platform/operators: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
                vi.spyOn(operatorService, "getPlatformUsers").mockResolvedValueOnce({ operators: [], total: 0 });
                const res = await getOperatorsRoute(createMockRequest("/api/platform/operators"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/operators: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getOperatorsRoute(createMockRequest("/api/platform/operators"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/operators: 403 forbidden when lacking OPERATORS_VIEW", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                const res = await getOperatorsRoute(createMockRequest("/api/platform/operators"));
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/operators: 201 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
                vi.spyOn(operatorService, "createPlatformUser").mockResolvedValueOnce({ operator: { userId: "usr_2" } as any });
                const res = await createOperatorRoute(
                    createMockRequest("/api/platform/operators", "POST", { email: "op2@aforden.com", platformRole: PlatformRole.PLATFORM_ADMIN, reason: "New hire." })
                );
                expect(res.status).toBe(201);
            });

            it("POST /api/platform/operators: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await createOperatorRoute(
                    createMockRequest("/api/platform/operators", "POST", { email: "op2@aforden.com", platformRole: PlatformRole.PLATFORM_ADMIN, reason: "New hire." })
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/operators: 403 forbidden when lacking OPERATORS_INVITE", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await createOperatorRoute(
                    createMockRequest("/api/platform/operators", "POST", { email: "op2@aforden.com", platformRole: PlatformRole.PLATFORM_ADMIN, reason: "New hire." })
                );
                expect(res.status).toBe(403);
            });

            it("PATCH /api/platform/operators/[operatorId]/role: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
                vi.spyOn(operatorService, "changePlatformRole").mockResolvedValueOnce({ userId: "usr_2" } as any);
                const res = await updateOperatorRoleRoute(
                    createMockRequest("/api/platform/operators/usr_2/role", "PATCH", { role: PlatformRole.PLATFORM_SECURITY, reason: "Promotion." }),
                    { params: Promise.resolve({ operatorId: "usr_2" }) }
                );
                expect(res.status).toBe(200);
            });

            it("PATCH /api/platform/operators/[operatorId]/role: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await updateOperatorRoleRoute(
                    createMockRequest("/api/platform/operators/usr_2/role", "PATCH", { role: PlatformRole.PLATFORM_SECURITY, reason: "Promotion." }),
                    { params: Promise.resolve({ operatorId: "usr_2" }) }
                );
                expect(res.status).toBe(401);
            });

            it("PATCH /api/platform/operators/[operatorId]/role: 403 forbidden when lacking OPERATORS_UPDATE_ROLE", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await updateOperatorRoleRoute(
                    createMockRequest("/api/platform/operators/usr_2/role", "PATCH", { role: PlatformRole.PLATFORM_SECURITY, reason: "Promotion." }),
                    { params: Promise.resolve({ operatorId: "usr_2" }) }
                );
                expect(res.status).toBe(403);
            });

            it("DELETE /api/platform/operators/[operatorId]: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
                vi.spyOn(operatorService, "deactivatePlatformUser").mockResolvedValueOnce({ userId: "usr_2" } as any);
                const res = await deactivateOperatorRoute(
                    createMockRequest("/api/platform/operators/usr_2", "DELETE", { reason: "Deprovisioning." }),
                    { params: Promise.resolve({ operatorId: "usr_2" }) }
                );
                expect(res.status).toBe(200);
            });

            it("DELETE /api/platform/operators/[operatorId]: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await deactivateOperatorRoute(
                    createMockRequest("/api/platform/operators/usr_2", "DELETE", { reason: "Deprovisioning." }),
                    { params: Promise.resolve({ operatorId: "usr_2" }) }
                );
                expect(res.status).toBe(401);
            });

            it("DELETE /api/platform/operators/[operatorId]: 403 forbidden when lacking OPERATORS_REVOKE", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await deactivateOperatorRoute(
                    createMockRequest("/api/platform/operators/usr_2", "DELETE", { reason: "Deprovisioning." }),
                    { params: Promise.resolve({ operatorId: "usr_2" }) }
                );
                expect(res.status).toBe(403);
            });
        });

        // --- 5. Feature Flags ---
        describe("5. Feature Flags Routes", () => {
            it("GET /api/platform/flags: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(flagService, "listFeatureFlags").mockResolvedValueOnce({ flags: [], total: 0 });
                const res = await getFlagsRoute(createMockRequest("/api/platform/flags"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/flags: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getFlagsRoute(createMockRequest("/api/platform/flags"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/flags: 403 forbidden when lacking CONFIG_VIEW", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                const res = await getFlagsRoute(createMockRequest("/api/platform/flags"));
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/flags: 201 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(flagService, "createFeatureFlag").mockResolvedValueOnce({ id: "flag_1" } as any);
                const res = await createFlagRoute(
                    createMockRequest("/api/platform/flags", "POST", { key: "beta.test", name: "Beta", reason: "Creation." })
                );
                expect(res.status).toBe(201);
            });

            it("POST /api/platform/flags: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await createFlagRoute(
                    createMockRequest("/api/platform/flags", "POST", { key: "beta.test", name: "Beta", reason: "Creation." })
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/flags: 403 forbidden when lacking CONFIG_MANAGE_FLAGS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await createFlagRoute(
                    createMockRequest("/api/platform/flags", "POST", { key: "beta.test", name: "Beta", reason: "Creation." })
                );
                expect(res.status).toBe(403);
            });

            it("PATCH /api/platform/flags/[flagId]: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(flagService, "updateFeatureFlag").mockResolvedValueOnce({ id: "flag_1" } as any);
                const res = await updateFlagRoute(
                    createMockRequest("/api/platform/flags/flag_1", "PATCH", { name: "Updated", reason: "Renaming." }),
                    { params: Promise.resolve({ flagId: "flag_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("PATCH /api/platform/flags/[flagId]: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await updateFlagRoute(
                    createMockRequest("/api/platform/flags/flag_1", "PATCH", { name: "Updated", reason: "Renaming." }),
                    { params: Promise.resolve({ flagId: "flag_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("PATCH /api/platform/flags/[flagId]: 403 forbidden when lacking CONFIG_MANAGE_FLAGS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await updateFlagRoute(
                    createMockRequest("/api/platform/flags/flag_1", "PATCH", { name: "Updated", reason: "Renaming." }),
                    { params: Promise.resolve({ flagId: "flag_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("DELETE /api/platform/flags/[flagId]: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(flagService, "deleteFeatureFlag").mockResolvedValueOnce({ success: true, deletedFlagId: "flag_1" } as any);
                const res = await deleteFlagRoute(
                    createMockRequest("/api/platform/flags/flag_1", "DELETE", { reason: "Deprecation." }),
                    { params: Promise.resolve({ flagId: "flag_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("DELETE /api/platform/flags/[flagId]: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await deleteFlagRoute(
                    createMockRequest("/api/platform/flags/flag_1", "DELETE", { reason: "Deprecation." }),
                    { params: Promise.resolve({ flagId: "flag_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("DELETE /api/platform/flags/[flagId]: 403 forbidden when lacking CONFIG_MANAGE_FLAGS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await deleteFlagRoute(
                    createMockRequest("/api/platform/flags/flag_1", "DELETE", { reason: "Deprecation." }),
                    { params: Promise.resolve({ flagId: "flag_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/flags/[flagId]/toggle: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(flagService, "toggleFeatureFlag").mockResolvedValueOnce({ id: "flag_1", enabled: true } as any);
                const res = await toggleFlagRoute(
                    createMockRequest("/api/platform/flags/flag_1/toggle", "POST", { enabled: true, reason: "Enabling." }),
                    { params: Promise.resolve({ flagId: "flag_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/flags/[flagId]/toggle: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await toggleFlagRoute(
                    createMockRequest("/api/platform/flags/flag_1/toggle", "POST", { enabled: true, reason: "Enabling." }),
                    { params: Promise.resolve({ flagId: "flag_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/flags/[flagId]/toggle: 403 forbidden when lacking CONFIG_MANAGE_FLAGS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await toggleFlagRoute(
                    createMockRequest("/api/platform/flags/flag_1/toggle", "POST", { enabled: true, reason: "Enabling." }),
                    { params: Promise.resolve({ flagId: "flag_1" }) }
                );
                expect(res.status).toBe(403);
            });
        });

        // --- 6. Runtime Settings ---
        describe("6. Runtime Settings Routes", () => {
            it("GET /api/platform/settings: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(settingService, "listSettings").mockResolvedValueOnce({ settings: [], total: 0 });
                const res = await getSettingsRoute(createMockRequest("/api/platform/settings"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/settings: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getSettingsRoute(createMockRequest("/api/platform/settings"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/settings: 403 forbidden when lacking CONFIG_VIEW", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                const res = await getSettingsRoute(createMockRequest("/api/platform/settings"));
                expect(res.status).toBe(403);
            });

            it("PUT /api/platform/settings/[key]: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(settingService, "upsertSetting").mockResolvedValueOnce({ key: "k", value: "v" } as any);
                const res = await upsertSettingRoute(
                    createMockRequest("/api/platform/settings/k", "PUT", { value: "v", reason: "Update." }),
                    { params: Promise.resolve({ key: "k" }) }
                );
                expect(res.status).toBe(200);
            });

            it("PUT /api/platform/settings/[key]: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await upsertSettingRoute(
                    createMockRequest("/api/platform/settings/k", "PUT", { value: "v", reason: "Update." }),
                    { params: Promise.resolve({ key: "k" }) }
                );
                expect(res.status).toBe(401);
            });

            it("PUT /api/platform/settings/[key]: 403 forbidden when lacking CONFIG_UPDATE_SETTINGS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await upsertSettingRoute(
                    createMockRequest("/api/platform/settings/k", "PUT", { value: "v", reason: "Update." }),
                    { params: Promise.resolve({ key: "k" }) }
                );
                expect(res.status).toBe(403);
            });
        });

        // --- 7. Developer Administration ---
        describe("7. Developer Administration Routes", () => {
            it("GET /api/platform/developer/apps: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(developerService, "listPlatformDeveloperApplications").mockResolvedValueOnce([]);
                const res = await getDeveloperAppsRoute(createMockRequest("/api/platform/developer/apps"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/developer/apps: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getDeveloperAppsRoute(createMockRequest("/api/platform/developer/apps"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/developer/apps: 403 forbidden when lacking DEVELOPER_VIEW_APPS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                const res = await getDeveloperAppsRoute(createMockRequest("/api/platform/developer/apps"));
                expect(res.status).toBe(403);
            });

            it("PATCH /api/platform/developer/apps/[appId]/status: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(developerService, "updatePlatformDeveloperApplicationStatus").mockResolvedValueOnce({ id: "app_1" } as any);
                const res = await updateDeveloperAppStatusRoute(
                    createMockRequest("/api/platform/developer/apps/app_1/status", "PATCH", { status: "ACTIVE", reason: "Reactivation." }),
                    { params: Promise.resolve({ appId: "app_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("PATCH /api/platform/developer/apps/[appId]/status: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await updateDeveloperAppStatusRoute(
                    createMockRequest("/api/platform/developer/apps/app_1/status", "PATCH", { status: "ACTIVE", reason: "Reactivation." }),
                    { params: Promise.resolve({ appId: "app_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("PATCH /api/platform/developer/apps/[appId]/status: 403 forbidden when lacking DEVELOPER_REVOKE_KEYS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await updateDeveloperAppStatusRoute(
                    createMockRequest("/api/platform/developer/apps/app_1/status", "PATCH", { status: "ACTIVE", reason: "Reactivation." }),
                    { params: Promise.resolve({ appId: "app_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/developer/keys/[keyId]/revoke: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(developerService, "revokePlatformApiKey").mockResolvedValueOnce({ success: true } as any);
                const res = await revokeApiKeyRoute(
                    createMockRequest("/api/platform/developer/keys/key_1/revoke", "POST", { reason: "Rotation." }),
                    { params: Promise.resolve({ keyId: "key_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/developer/keys/[keyId]/revoke: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await revokeApiKeyRoute(
                    createMockRequest("/api/platform/developer/keys/key_1/revoke", "POST", { reason: "Rotation." }),
                    { params: Promise.resolve({ keyId: "key_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/developer/keys/[keyId]/revoke: 403 forbidden when lacking DEVELOPER_REVOKE_KEYS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await revokeApiKeyRoute(
                    createMockRequest("/api/platform/developer/keys/key_1/revoke", "POST", { reason: "Rotation." }),
                    { params: Promise.resolve({ keyId: "key_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/developer/webhooks/[webhookId]/disable: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(developerService, "disablePlatformWebhookEndpoint").mockResolvedValueOnce({ id: "wh_1" } as any);
                const res = await disableWebhookRoute(
                    createMockRequest("/api/platform/developer/webhooks/wh_1/disable", "POST", { reason: "Failing." }),
                    { params: Promise.resolve({ webhookId: "wh_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/developer/webhooks/[webhookId]/disable: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await disableWebhookRoute(
                    createMockRequest("/api/platform/developer/webhooks/wh_1/disable", "POST", { reason: "Failing." }),
                    { params: Promise.resolve({ webhookId: "wh_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/developer/webhooks/[webhookId]/disable: 403 forbidden when lacking DEVELOPER_MANAGE_WEBHOOKS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await disableWebhookRoute(
                    createMockRequest("/api/platform/developer/webhooks/wh_1/disable", "POST", { reason: "Failing." }),
                    { params: Promise.resolve({ webhookId: "wh_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/developer/rate-limits/reset: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(developerService, "resetPlatformRateLimit").mockResolvedValueOnce({ success: true, key: "k" });
                const res = await resetRateLimitRoute(
                    createMockRequest("/api/platform/developer/rate-limits/reset", "POST", { key: "k", targetType: "WORKSPACE", reason: "Reset." })
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/developer/rate-limits/reset: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await resetRateLimitRoute(
                    createMockRequest("/api/platform/developer/rate-limits/reset", "POST", { key: "k", targetType: "WORKSPACE", reason: "Reset." })
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/developer/rate-limits/reset: 403 forbidden when lacking DEVELOPER_MANAGE_WEBHOOKS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await resetRateLimitRoute(
                    createMockRequest("/api/platform/developer/rate-limits/reset", "POST", { key: "k", targetType: "WORKSPACE", reason: "Reset." })
                );
                expect(res.status).toBe(403);
            });
        });

        // --- 8. Integration Administration ---
        describe("8. Integration Administration Routes", () => {
            it("GET /api/platform/integrations: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(integrationService, "listPlatformIntegrations").mockResolvedValueOnce([]);
                const res = await getIntegrationsRoute(createMockRequest("/api/platform/integrations"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/integrations: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getIntegrationsRoute(createMockRequest("/api/platform/integrations"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/integrations: 403 forbidden when lacking CONFIG_VIEW", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                const res = await getIntegrationsRoute(createMockRequest("/api/platform/integrations"));
                expect(res.status).toBe(403);
            });

            it("PATCH /api/platform/integrations/connections/[connectionId]/status: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(integrationService, "updatePlatformIntegrationConnectionStatus").mockResolvedValueOnce({ id: "conn_1" } as any);
                const res = await updateConnectionStatusRoute(
                    createMockRequest("/api/platform/integrations/connections/conn_1/status", "PATCH", { status: "ACTIVE", reason: "Reactivated." }),
                    { params: Promise.resolve({ connectionId: "conn_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("PATCH /api/platform/integrations/connections/[connectionId]/status: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await updateConnectionStatusRoute(
                    createMockRequest("/api/platform/integrations/connections/conn_1/status", "PATCH", { status: "ACTIVE", reason: "Reactivated." }),
                    { params: Promise.resolve({ connectionId: "conn_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("PATCH /api/platform/integrations/connections/[connectionId]/status: 403 forbidden when lacking CONFIG_UPDATE_SETTINGS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await updateConnectionStatusRoute(
                    createMockRequest("/api/platform/integrations/connections/conn_1/status", "PATCH", { status: "ACTIVE", reason: "Reactivated." }),
                    { params: Promise.resolve({ connectionId: "conn_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/integrations/credentials/[credentialId]/revoke: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(integrationService, "revokePlatformIntegrationCredential").mockResolvedValueOnce({ id: "c_1" } as any);
                const res = await revokeIntegrationCredentialRoute(
                    createMockRequest("/api/platform/integrations/credentials/c_1/revoke", "POST", { reason: "Security cleanup." }),
                    { params: Promise.resolve({ credentialId: "c_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/integrations/credentials/[credentialId]/revoke: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await revokeIntegrationCredentialRoute(
                    createMockRequest("/api/platform/integrations/credentials/c_1/revoke", "POST", { reason: "Security cleanup." }),
                    { params: Promise.resolve({ credentialId: "c_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/integrations/credentials/[credentialId]/revoke: 403 forbidden when lacking INTEGRATIONS_REVOKE_CREDENTIALS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await revokeIntegrationCredentialRoute(
                    createMockRequest("/api/platform/integrations/credentials/c_1/revoke", "POST", { reason: "Security cleanup." }),
                    { params: Promise.resolve({ credentialId: "c_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/integrations/connections/[connectionId]/test: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(integrationService, "testPlatformIntegrationConnection").mockResolvedValueOnce({ success: true, message: "OK" } as any);
                const res = await testIntegrationConnectionRoute(
                    createMockRequest("/api/platform/integrations/connections/conn_1/test", "POST", { reason: "Diagnostic." }),
                    { params: Promise.resolve({ connectionId: "conn_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/integrations/connections/[connectionId]/test: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await testIntegrationConnectionRoute(
                    createMockRequest("/api/platform/integrations/connections/conn_1/test", "POST", { reason: "Diagnostic." }),
                    { params: Promise.resolve({ connectionId: "conn_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/integrations/connections/[connectionId]/test: 403 forbidden when lacking CONFIG_UPDATE_SETTINGS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await testIntegrationConnectionRoute(
                    createMockRequest("/api/platform/integrations/connections/conn_1/test", "POST", { reason: "Diagnostic." }),
                    { params: Promise.resolve({ connectionId: "conn_1" }) }
                );
                expect(res.status).toBe(403);
            });
        });

        // --- 9. Billing Administration ---
        describe("9. Billing Administration Routes", () => {
            it("GET /api/platform/billing/accounts: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                vi.spyOn(billingService, "listPlatformBillingAccounts").mockResolvedValueOnce([]);
                const res = await getBillingAccountsRoute(createMockRequest("/api/platform/billing/accounts"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/billing/accounts: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getBillingAccountsRoute(createMockRequest("/api/platform/billing/accounts"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/billing/accounts: 403 forbidden when lacking BILLING_VIEW", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OPERATIONS);
                const res = await getBillingAccountsRoute(createMockRequest("/api/platform/billing/accounts"));
                expect(res.status).toBe(403);
            });

            it("GET /api/platform/billing/plans: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                vi.spyOn(billingService, "listPlatformSubscriptionPlans").mockResolvedValueOnce([]);
                const res = await getBillingPlansRoute(createMockRequest("/api/platform/billing/plans"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/billing/plans: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getBillingPlansRoute(createMockRequest("/api/platform/billing/plans"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/billing/plans: 403 forbidden when lacking BILLING_VIEW", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OPERATIONS);
                const res = await getBillingPlansRoute(createMockRequest("/api/platform/billing/plans"));
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/billing/workspaces/[workspaceId]/plan: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                vi.spyOn(billingService, "assignPlatformSubscriptionPlan").mockResolvedValueOnce({ id: "sub_1" } as any);
                const res = await assignPlanRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/plan", "POST", { planId: "p_1", reason: "Contract." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/billing/workspaces/[workspaceId]/plan: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await assignPlanRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/plan", "POST", { planId: "p_1", reason: "Contract." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/billing/workspaces/[workspaceId]/plan: 403 forbidden when lacking BILLING_MANAGE_PLANS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await assignPlanRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/plan", "POST", { planId: "p_1", reason: "Contract." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/billing/workspaces/[workspaceId]/entitlements: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                vi.spyOn(billingService, "overridePlatformWorkspaceEntitlement").mockResolvedValueOnce({ id: "ent_1" } as any);
                const res = await overrideEntitlementRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/entitlements", "POST", { featureKey: "f", value: 10, type: "NUMERIC", reason: "Override." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/billing/workspaces/[workspaceId]/entitlements: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await overrideEntitlementRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/entitlements", "POST", { featureKey: "f", value: 10, type: "NUMERIC", reason: "Override." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/billing/workspaces/[workspaceId]/entitlements: 403 forbidden when lacking BILLING_OVERRIDE_ENTITLEMENTS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await overrideEntitlementRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/entitlements", "POST", { featureKey: "f", value: 10, type: "NUMERIC", reason: "Override." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("DELETE /api/platform/billing/workspaces/[workspaceId]/entitlements/[featureKey]: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                vi.spyOn(billingService, "removePlatformWorkspaceEntitlementOverride").mockResolvedValueOnce({ success: true, revokedFeatureKey: "f" });
                const res = await removeEntitlementRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/entitlements/f", "DELETE", { reason: "Cleanup." }),
                    { params: Promise.resolve({ workspaceId: "ws_1", featureKey: "f" }) }
                );
                expect(res.status).toBe(200);
            });

            it("DELETE /api/platform/billing/workspaces/[workspaceId]/entitlements/[featureKey]: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await removeEntitlementRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/entitlements/f", "DELETE", { reason: "Cleanup." }),
                    { params: Promise.resolve({ workspaceId: "ws_1", featureKey: "f" }) }
                );
                expect(res.status).toBe(401);
            });

            it("DELETE /api/platform/billing/workspaces/[workspaceId]/entitlements/[featureKey]: 403 forbidden when lacking BILLING_OVERRIDE_ENTITLEMENTS", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await removeEntitlementRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/entitlements/f", "DELETE", { reason: "Cleanup." }),
                    { params: Promise.resolve({ workspaceId: "ws_1", featureKey: "f" }) }
                );
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/billing/workspaces/[workspaceId]/sync: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                vi.spyOn(billingService, "syncPlatformBillingAccount").mockResolvedValueOnce({ success: true } as any);
                const res = await syncBillingAccountRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/sync", "POST", { reason: "Syncing." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/billing/workspaces/[workspaceId]/sync: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await syncBillingAccountRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/sync", "POST", { reason: "Syncing." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/billing/workspaces/[workspaceId]/sync: 403 forbidden when lacking BILLING_SYNC_GATEWAY", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await syncBillingAccountRoute(
                    createMockRequest("/api/platform/billing/workspaces/ws_1/sync", "POST", { reason: "Syncing." }),
                    { params: Promise.resolve({ workspaceId: "ws_1" }) }
                );
                expect(res.status).toBe(403);
            });

            it("POST /api/platform/billing/webhooks/[eventId]/replay: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                vi.spyOn(billingService, "replayPlatformBillingWebhook").mockResolvedValueOnce({ success: true } as any);
                const res = await replayBillingWebhookRoute(
                    createMockRequest("/api/platform/billing/webhooks/e_1/replay", "POST", { reason: "Replaying." }),
                    { params: Promise.resolve({ eventId: "e_1" }) }
                );
                expect(res.status).toBe(200);
            });

            it("POST /api/platform/billing/webhooks/[eventId]/replay: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await replayBillingWebhookRoute(
                    createMockRequest("/api/platform/billing/webhooks/e_1/replay", "POST", { reason: "Replaying." }),
                    { params: Promise.resolve({ eventId: "e_1" }) }
                );
                expect(res.status).toBe(401);
            });

            it("POST /api/platform/billing/webhooks/[eventId]/replay: 403 forbidden when lacking BILLING_SYNC_GATEWAY", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await replayBillingWebhookRoute(
                    createMockRequest("/api/platform/billing/webhooks/e_1/replay", "POST", { reason: "Replaying." }),
                    { params: Promise.resolve({ eventId: "e_1" }) }
                );
                expect(res.status).toBe(403);
            });
        });

        // --- 10. System Health ---
        describe("10. System Health Routes", () => {
            it("GET /api/platform/health: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OPERATIONS);
                vi.spyOn(healthService, "getPlatformSystemHealthSummary").mockResolvedValueOnce({ status: "HEALTHY" } as any);
                const res = await getHealthSummaryRoute(createMockRequest("/api/platform/health"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/health: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getHealthSummaryRoute(createMockRequest("/api/platform/health"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/health: 403 forbidden when lacking OPERATIONS_VIEW_QUEUES", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await getHealthSummaryRoute(createMockRequest("/api/platform/health"));
                expect(res.status).toBe(403);
            });

            it("GET /api/platform/health/queues: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_OPERATIONS);
                vi.spyOn(healthService, "getPlatformQueueHealth").mockResolvedValueOnce({ status: "HEALTHY" } as any);
                const res = await getHealthQueuesRoute(createMockRequest("/api/platform/health/queues"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/health/queues: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getHealthQueuesRoute(createMockRequest("/api/platform/health/queues"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/health/queues: 403 forbidden when lacking OPERATIONS_VIEW_QUEUES", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_SUPPORT);
                const res = await getHealthQueuesRoute(createMockRequest("/api/platform/health/queues"));
                expect(res.status).toBe(403);
            });

            it("GET /api/platform/health/rate-limiter: 200 success", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
                vi.spyOn(healthService, "getPlatformRateLimiterBlockerStatus").mockResolvedValueOnce({ status: "DEGRADED" } as any);
                const res = await getHealthRateLimiterRoute(createMockRequest("/api/platform/health/rate-limiter"));
                expect(res.status).toBe(200);
            });

            it("GET /api/platform/health/rate-limiter: 401 unauthenticated", async () => {
                mockUnauthenticated();
                const res = await getHealthRateLimiterRoute(createMockRequest("/api/platform/health/rate-limiter"));
                expect(res.status).toBe(401);
            });

            it("GET /api/platform/health/rate-limiter: 403 forbidden when lacking CONFIG_VIEW", async () => {
                mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
                const res = await getHealthRateLimiterRoute(createMockRequest("/api/platform/health/rate-limiter"));
                expect(res.status).toBe(403);
            });
        });
    });

    // =========================================================================
    // 3. Dedicated Step-Up Missing (403 STEP_UP_REQUIRED) Tests for all 13 Tier-2 Routes
    // =========================================================================
    describe("3. Dedicated Step-Up Missing (403 STEP_UP_REQUIRED) for all 13 Tier-2 Routes", () => {
        it("1. POST /api/platform/workspaces/[workspaceId]/suspend returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
            vi.spyOn(workspaceService, "suspendWorkspace").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await suspendWorkspaceRoute(
                createMockRequest("/api/platform/workspaces/ws_1/suspend", "POST", { reason: "Terms violation." }),
                { params: Promise.resolve({ workspaceId: "ws_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("2. POST /api/platform/workspaces/[workspaceId]/reactivate returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
            vi.spyOn(workspaceService, "reactivateWorkspace").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await reactivateWorkspaceRoute(
                createMockRequest("/api/platform/workspaces/ws_1/reactivate", "POST", { reason: "Balance resolved." }),
                { params: Promise.resolve({ workspaceId: "ws_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("3. POST /api/platform/operators returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
            vi.spyOn(operatorService, "createPlatformUser").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await createOperatorRoute(
                createMockRequest("/api/platform/operators", "POST", { email: "new@aforden.com", platformRole: PlatformRole.PLATFORM_ADMIN, reason: "New operator." })
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("4. PATCH /api/platform/operators/[operatorId]/role returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
            vi.spyOn(operatorService, "changePlatformRole").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await updateOperatorRoleRoute(
                createMockRequest("/api/platform/operators/usr_1/role", "PATCH", { role: PlatformRole.PLATFORM_SECURITY, reason: "Role change." }),
                { params: Promise.resolve({ operatorId: "usr_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("5. DELETE /api/platform/operators/[operatorId] returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_OWNER);
            vi.spyOn(operatorService, "deactivatePlatformUser").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await deactivateOperatorRoute(
                createMockRequest("/api/platform/operators/usr_1", "DELETE", { reason: "Deactivation." }),
                { params: Promise.resolve({ operatorId: "usr_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("6. DELETE /api/platform/flags/[flagId] returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
            vi.spyOn(flagService, "deleteFeatureFlag").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await deleteFlagRoute(
                createMockRequest("/api/platform/flags/flag_1", "DELETE", { reason: "Flag deletion." }),
                { params: Promise.resolve({ flagId: "flag_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("7. PATCH /api/platform/developer/apps/[appId]/status returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
            vi.spyOn(developerService, "updatePlatformDeveloperApplicationStatus").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await updateDeveloperAppStatusRoute(
                createMockRequest("/api/platform/developer/apps/app_1/status", "PATCH", { status: "SUSPENDED", reason: "Suspension." }),
                { params: Promise.resolve({ appId: "app_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("8. POST /api/platform/developer/keys/[keyId]/revoke returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
            vi.spyOn(developerService, "revokePlatformApiKey").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await revokeApiKeyRoute(
                createMockRequest("/api/platform/developer/keys/key_1/revoke", "POST", { reason: "Key rotation." }),
                { params: Promise.resolve({ keyId: "key_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("9. PATCH /api/platform/integrations/connections/[connectionId]/status returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
            vi.spyOn(integrationService, "updatePlatformIntegrationConnectionStatus").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await updateConnectionStatusRoute(
                createMockRequest("/api/platform/integrations/connections/c_1/status", "PATCH", { status: "REVOKED", reason: "Connection revoked." }),
                { params: Promise.resolve({ connectionId: "c_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("10. POST /api/platform/integrations/credentials/[credentialId]/revoke returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
            vi.spyOn(integrationService, "revokePlatformIntegrationCredential").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await revokeIntegrationCredentialRoute(
                createMockRequest("/api/platform/integrations/credentials/cred_1/revoke", "POST", { reason: "Secret revoked." }),
                { params: Promise.resolve({ credentialId: "cred_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("11. POST /api/platform/billing/workspaces/[workspaceId]/plan returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
            vi.spyOn(billingService, "assignPlatformSubscriptionPlan").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await assignPlanRoute(
                createMockRequest("/api/platform/billing/workspaces/ws_1/plan", "POST", { planId: "p_1", reason: "Plan override." }),
                { params: Promise.resolve({ workspaceId: "ws_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("12. POST /api/platform/billing/workspaces/[workspaceId]/entitlements returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
            vi.spyOn(billingService, "overridePlatformWorkspaceEntitlement").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await overrideEntitlementRoute(
                createMockRequest("/api/platform/billing/workspaces/ws_1/entitlements", "POST", { featureKey: "f", value: 10, type: "NUMERIC", reason: "Override." }),
                { params: Promise.resolve({ workspaceId: "ws_1" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });

        it("13. DELETE /api/platform/billing/workspaces/[workspaceId]/entitlements/[featureKey] returns 403 STEP_UP_REQUIRED when step-up is missing", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_BILLING);
            vi.spyOn(billingService, "removePlatformWorkspaceEntitlementOverride").mockRejectedValueOnce(new PlatformStepUpAuthenticationRequiredError());
            const res = await removeEntitlementRoute(
                createMockRequest("/api/platform/billing/workspaces/ws_1/entitlements/f", "DELETE", { reason: "Override removal." }),
                { params: Promise.resolve({ workspaceId: "ws_1", featureKey: "f" }) }
            );
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_REQUIRED");
        });
    });

    // =========================================================================
    // 4. Pass-Through Invariant & Zero Route Audit Duplication
    // =========================================================================
    describe("4. Pass-Through Invariant & Zero Route Audit Duplication", () => {
        it("strictly confirms route wrappers do not call prisma.platformAuditLog.create", async () => {
            mockAuthenticatedOperator(PlatformRole.PLATFORM_ADMIN);
            vi.spyOn(workspaceService, "getWorkspaces").mockResolvedValueOnce({
                workspaces: [],
                total: 0,
            });

            const req = createMockRequest("/api/platform/workspaces");
            await getWorkspacesRoute(req);

            // Confirms zero audit log mutation from route handler layer:
            expect(auditCreateMock).not.toHaveBeenCalled();
        });
    });
});
