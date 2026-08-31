import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, userFindUniqueMock, profileUpdateMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
    profileUpdateMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: userFindUniqueMock,
        },
        platformAdminProfile: {
            update: profileUpdateMock,
        },
    },
}));

import {
    requirePlatformAuthorization,
    requirePlatformPermission,
    PlatformRole,
    PlatformAdminStatus,
    PlatformAuthorizationContext,
    PLATFORM_PERMISSIONS,
    PlatformUnauthorizedError,
    PlatformAccessDeniedError,
    PlatformAdminInactiveError,
    PlatformSessionExpiredError,
    assertPlatformPermission,
} from "@/lib/services/platform/authorization";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

describe("Phase 1.19.4 — Platform Authorization Boundary Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Full Pipeline Integration & Context Population", () => {
        it("authenticates and resolves active platform operator with required permission", async () => {
            const now = new Date();
            authMock.mockResolvedValueOnce({
                user: { id: "usr_admin_1", email: "admin@aforden.com" },
            });

            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_admin_1",
                name: "Admin Alice",
                email: "admin@aforden.com",
                avatarUrl: "https://aforden.com/avatar.jpg",
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_ADMIN,
                platformAdminProfile: {
                    id: "prof_admin_1",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: now,
                    lastLoginAt: now,
                    stepUpConfirmedAt: null,
                    metadata: { region: "us-east-1" },
                },
            });

            const context = await requirePlatformAuthorization(
                PLATFORM_PERMISSIONS.WORKSPACES_VIEW
            );

            expect(context).toBeDefined();
            expect(context.userId).toBe("usr_admin_1");
            expect(context.email).toBe("admin@aforden.com");
            expect(context.name).toBe("Admin Alice");
            expect(context.avatarUrl).toBe("https://aforden.com/avatar.jpg");
            expect(context.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
            expect(context.profileId).toBe("prof_admin_1");
            expect(context.status).toBe(PlatformAdminStatus.ACTIVE);
            expect(context.metadata).toEqual({ region: "us-east-1" });
        });

        it("works interchangeably via requirePlatformPermission alias", async () => {
            authMock.mockResolvedValueOnce({
                user: { id: "usr_owner_1", email: "owner@aforden.com" },
            });

            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_owner_1",
                name: "Owner Bob",
                email: "owner@aforden.com",
                avatarUrl: null,
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_OWNER,
                platformAdminProfile: {
                    id: "prof_owner_1",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: new Date(),
                    lastLoginAt: null,
                    stepUpConfirmedAt: null,
                    metadata: null,
                },
            });

            const context = await requirePlatformPermission(
                PLATFORM_PERMISSIONS.OPERATORS_INVITE
            );
            expect(context.platformRole).toBe(PlatformRole.PLATFORM_OWNER);
        });

        it("evaluates multiple permissions with requireAll: true", async () => {
            authMock.mockResolvedValueOnce({
                user: { id: "usr_admin_2", email: "admin2@aforden.com" },
            });

            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_admin_2",
                name: "Admin 2",
                email: "admin2@aforden.com",
                avatarUrl: null,
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_ADMIN,
                platformAdminProfile: {
                    id: "prof_admin_2",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: new Date(),
                    lastLoginAt: null,
                    stepUpConfirmedAt: null,
                    metadata: null,
                },
            });

            const context = await requirePlatformAuthorization(
                [
                    PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
                    PLATFORM_PERMISSIONS.CONFIG_VIEW,
                ],
                { requireAll: true }
            );

            expect(context.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
        });

        it("evaluates multiple permissions with requireAll: false (any permission satisfies)", async () => {
            authMock.mockResolvedValueOnce({
                user: { id: "usr_support_1", email: "support@aforden.com" },
            });

            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_support_1",
                name: "Support User",
                email: "support@aforden.com",
                avatarUrl: null,
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_SUPPORT,
                platformAdminProfile: {
                    id: "prof_support_1",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: new Date(),
                    lastLoginAt: null,
                    stepUpConfirmedAt: null,
                    metadata: null,
                },
            });

            // Support has WORKSPACES_VIEW, but lacks WORKSPACES_CREATE
            const context = await requirePlatformAuthorization([
                PLATFORM_PERMISSIONS.WORKSPACES_CREATE,
                PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
            ]);

            expect(context.platformRole).toBe(PlatformRole.PLATFORM_SUPPORT);
        });
    });

    describe("2. Authority Separation Invariant (1.19.1 Invariant #1)", () => {
        it("denies workspace-only user (e.g. tenant OWNER with no platformRole)", async () => {
            authMock.mockResolvedValueOnce({
                user: { id: "usr_workspace_owner", email: "tenant_owner@client.com" },
            });

            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_workspace_owner",
                name: "Tenant Owner",
                email: "tenant_owner@client.com",
                avatarUrl: null,
                status: "ACTIVE",
                platformRole: null, // Zero platform authority
                platformAdminProfile: null,
            });

            await expect(
                requirePlatformAuthorization(PLATFORM_PERMISSIONS.WORKSPACES_VIEW)
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("denies unauthenticated request with PlatformUnauthorizedError (HTTP 401)", async () => {
            authMock.mockResolvedValueOnce(null);

            await expect(
                requirePlatformAuthorization(PLATFORM_PERMISSIONS.WORKSPACES_VIEW)
            ).rejects.toThrow(PlatformUnauthorizedError);
        });

        it("denies operator lacking the required granular permission", async () => {
            authMock.mockResolvedValueOnce({
                user: { id: "usr_admin_3", email: "admin3@aforden.com" },
            });

            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_admin_3",
                name: "Admin 3",
                email: "admin3@aforden.com",
                avatarUrl: null,
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_ADMIN,
                platformAdminProfile: {
                    id: "prof_admin_3",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: new Date(),
                    lastLoginAt: null,
                    stepUpConfirmedAt: null,
                    metadata: null,
                },
            });

            // PLATFORM_ADMIN is strictly denied WORKSPACES_DELETE
            await expect(
                requirePlatformAuthorization(PLATFORM_PERMISSIONS.WORKSPACES_DELETE)
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("denies platform operator with INACTIVE PlatformAdminProfile", async () => {
            authMock.mockResolvedValueOnce({
                user: { id: "usr_inactive_op", email: "inactive@aforden.com" },
            });

            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_inactive_op",
                name: "Inactive Operator",
                email: "inactive@aforden.com",
                avatarUrl: null,
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_ADMIN,
                platformAdminProfile: {
                    id: "prof_inactive_op",
                    status: PlatformAdminStatus.INACTIVE,
                    lastActiveAt: new Date(),
                    lastLoginAt: null,
                    stepUpConfirmedAt: null,
                    metadata: null,
                },
            });

            await expect(
                requirePlatformAuthorization(PLATFORM_PERMISSIONS.WORKSPACES_VIEW)
            ).rejects.toThrow(PlatformAdminInactiveError);
        });

        it("denies platform operator with idle session exceeding 30 minutes", async () => {
            const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);
            authMock.mockResolvedValueOnce({
                user: { id: "usr_idle_op", email: "idle@aforden.com" },
            });

            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_idle_op",
                name: "Idle Operator",
                email: "idle@aforden.com",
                avatarUrl: null,
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_ADMIN,
                platformAdminProfile: {
                    id: "prof_idle_op",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: fortyMinutesAgo,
                    lastLoginAt: null,
                    stepUpConfirmedAt: null,
                    metadata: null,
                },
            });

            await expect(
                requirePlatformAuthorization(PLATFORM_PERMISSIONS.WORKSPACES_VIEW)
            ).rejects.toThrow(PlatformSessionExpiredError);
        });
    });

    describe("3. Dedicated Context Isolation & Cross-Boundary Rejection (1.19.1 Invariant #2)", () => {
        it("rejects passing a PlatformAuthorizationContext to workspace-level assertPermission", () => {
            const platformContext: PlatformAuthorizationContext = {
                userId: "usr_platform_owner",
                email: "owner@aforden.com",
                name: "Platform Owner",
                avatarUrl: null,
                platformRole: PlatformRole.PLATFORM_OWNER,
                profileId: "prof_owner",
                status: PlatformAdminStatus.ACTIVE,
                lastActiveAt: new Date(),
                lastLoginAt: null,
                stepUpConfirmedAt: null,
                metadata: null,
            };

            // Passing platformContext where MembershipRole is expected must throw runtime ForbiddenError
            expect(() =>
                assertPermission(
                    (platformContext as any).platformRole, // "PLATFORM_OWNER" is not a MembershipRole (OWNER, ADMIN, DISPATCHER, etc.)
                    PERMISSIONS.WORK_ORDERS_CREATE
                )
            ).toThrow();
        });

        it("rejects passing a WorkspaceAuthorizationContext to platform-level assertPlatformPermission", () => {
            const workspaceContext: WorkspaceAuthorizationContext = {
                user: {
                    id: "usr_tenant_owner",
                    email: "tenant@client.com",
                    name: "Tenant Owner",
                    status: "ACTIVE",
                    emailVerified: new Date(),
                },
                workspace: {
                    id: "ws_client_1",
                    name: "Client Workspace",
                    slug: "client-ws",
                    logoUrl: null,
                    timezone: "UTC",
                },
                membership: {
                    id: "mem_client_1",
                    role: "OWNER",
                    status: "ACTIVE",
                },
            };

            // Passing workspaceContext where PlatformAuthorizationContext is expected throws PlatformAccessDeniedError
            expect(() =>
                assertPlatformPermission(
                    workspaceContext as any,
                    PLATFORM_PERMISSIONS.WORKSPACES_VIEW
                )
            ).toThrow(PlatformAccessDeniedError);
        });
    });

    describe("4. Enumeration Resistance (Anti-Reconnaissance)", () => {
        it("returns identical error class and status code for workspace-only user vs unknown user", async () => {
            // Case A: User exists in DB as tenant owner, but platformRole is null
            authMock.mockResolvedValueOnce({
                user: { id: "usr_tenant", email: "tenant@aforden.com" },
            });
            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_tenant",
                name: "Tenant User",
                email: "tenant@aforden.com",
                avatarUrl: null,
                status: "ACTIVE",
                platformRole: null,
                platformAdminProfile: null,
            });

            let errorA: any;
            try {
                await requirePlatformAuthorization(PLATFORM_PERMISSIONS.WORKSPACES_VIEW);
            } catch (err) {
                errorA = err;
            }

            // Case B: Session user ID not found in database at all
            authMock.mockResolvedValueOnce({
                user: { id: "usr_ghost", email: "ghost@aforden.com" },
            });
            userFindUniqueMock.mockResolvedValueOnce(null);

            let errorB: any;
            try {
                await requirePlatformAuthorization(PLATFORM_PERMISSIONS.WORKSPACES_VIEW);
            } catch (err) {
                errorB = err;
            }

            // Case C: User exists with platformRole but missing PlatformAdminProfile record
            authMock.mockResolvedValueOnce({
                user: { id: "usr_broken", email: "broken@aforden.com" },
            });
            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_broken",
                name: "Broken User",
                email: "broken@aforden.com",
                avatarUrl: null,
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_ADMIN,
                platformAdminProfile: null,
            });

            let errorC: any;
            try {
                await requirePlatformAuthorization(PLATFORM_PERMISSIONS.WORKSPACES_VIEW);
            } catch (err) {
                errorC = err;
            }

            // All three cases must throw PlatformAccessDeniedError with identical status code (403) and code
            expect(errorA).toBeInstanceOf(PlatformAccessDeniedError);
            expect(errorB).toBeInstanceOf(PlatformAccessDeniedError);
            expect(errorC).toBeInstanceOf(PlatformAccessDeniedError);

            expect(errorA.statusCode).toBe(403);
            expect(errorB.statusCode).toBe(403);
            expect(errorC.statusCode).toBe(403);

            expect(errorA.code).toBe("PLATFORM_ACCESS_DENIED");
            expect(errorB.code).toBe("PLATFORM_ACCESS_DENIED");
            expect(errorC.code).toBe("PLATFORM_ACCESS_DENIED");
        });
    });
});
