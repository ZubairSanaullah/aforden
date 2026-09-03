import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prisma: {
        workspaceMember: {
            findFirst: vi.fn(),
        },
    },
}));

vi.mock("@/lib/prisma", () => ({
    prisma: mocks.prisma,
}));

import {
    ROLE_PERMISSIONS,
    getRolePermissions,
    roleHasPermission,
    roleHasAnyPermission,
    roleHasAllPermissions,
} from "@/lib/auth/roles";
import {
    ALL_PERMISSIONS,
    PERMISSIONS,
    type Permission,
} from "@/lib/auth/permissions";
import {
    getAuthorizationContext,
    getUserPermissions,
    hasPermission,
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
} from "@/lib/auth/authorization";
import {
    ForbiddenError,
    UnauthorizedError,
    WorkspaceAccessError,
} from "@/lib/auth/errors";
import {
    ROLE_HIERARCHY,
    roleHasMinimumLevel,
    roleIsHigherThan,
} from "@/lib/services/authorization/roleHierarchy";
import type { MembershipRole } from "@/generated/prisma/enums";

describe("Phase 1.21.2 — Role Hierarchy, Permissions Matrix & Authorization Hardening", () => {
    const ALL_ROLES: MembershipRole[] = [
        "OWNER",
        "ADMIN",
        "MANAGER",
        "DISPATCHER",
        "TECHNICIAN",
        "ACCOUNTANT",
    ];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Complete Role-Permission Matrix (`lib/auth/roles.ts`)", () => {
        it("defines permissions for every system role in MembershipRole enum", () => {
            for (const role of ALL_ROLES) {
                const perms = getRolePermissions(role);
                expect(Array.isArray(perms)).toBe(true);
                expect(perms.length).toBeGreaterThan(0);
            }
        });

        it("OWNER possesses ALL_PERMISSIONS without exception", () => {
            const ownerPerms = getRolePermissions("OWNER");
            expect(ownerPerms).toEqual(ALL_PERMISSIONS);
            for (const perm of ALL_PERMISSIONS) {
                expect(roleHasPermission("OWNER", perm)).toBe(true);
            }
            expect(roleHasAllPermissions("OWNER", ALL_PERMISSIONS)).toBe(true);
            expect(roleHasAnyPermission("OWNER", [PERMISSIONS.BILLING_MANAGE])).toBe(true);
        });

        it("ADMIN has management permissions across customers, work orders, members, settings, and billing", () => {
            expect(roleHasPermission("ADMIN", PERMISSIONS.CUSTOMERS_CREATE)).toBe(true);
            expect(roleHasPermission("ADMIN", PERMISSIONS.MEMBERS_INVITE)).toBe(true);
            expect(roleHasPermission("ADMIN", PERMISSIONS.BILLING_MANAGE)).toBe(true);
            expect(roleHasPermission("ADMIN", PERMISSIONS.INTEGRATIONS_MANAGE_CREDENTIALS)).toBe(true);
        });

        it("DISPATCHER has scheduling and assignment permissions but lacks billing/settings management", () => {
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.SCHEDULER_CREATE)).toBe(true);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.WORK_ORDERS_ASSIGN)).toBe(true);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.CUSTOMERS_UPDATE)).toBe(true);

            expect(roleHasPermission("DISPATCHER", PERMISSIONS.BILLING_MANAGE)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.SETTINGS_UPDATE)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.MEMBERS_INVITE)).toBe(false);
        });

        it("TECHNICIAN has field execution permissions and lacks dispatch/admin capabilities", () => {
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.WORK_ORDERS_VIEW)).toBe(true);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.WORK_ORDERS_COMPLETE)).toBe(true);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.SCHEDULER_VIEW)).toBe(true);

            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.WORK_ORDERS_ASSIGN)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.BILLING_VIEW)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.CUSTOMERS_DELETE)).toBe(false);
        });

        it("ACCOUNTANT has financial/billing view and manage permissions but lacks operational mutations", () => {
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.BILLING_VIEW)).toBe(true);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.BILLING_MANAGE)).toBe(true);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.CUSTOMERS_VIEW)).toBe(true);

            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_CREATE)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_ASSIGN)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.SCHEDULER_CREATE)).toBe(false);
        });

        it("roleHasAnyPermission and roleHasAllPermissions evaluate predicate arrays correctly", () => {
            expect(
                roleHasAnyPermission("ACCOUNTANT", [
                    PERMISSIONS.WORK_ORDERS_CREATE,
                    PERMISSIONS.BILLING_VIEW,
                ]),
            ).toBe(true);

            expect(
                roleHasAnyPermission("ACCOUNTANT", [
                    PERMISSIONS.WORK_ORDERS_CREATE,
                    PERMISSIONS.WORK_ORDERS_ASSIGN,
                ]),
            ).toBe(false);

            expect(
                roleHasAllPermissions("ACCOUNTANT", [
                    PERMISSIONS.CUSTOMERS_VIEW,
                    PERMISSIONS.BILLING_VIEW,
                ]),
            ).toBe(true);

            expect(
                roleHasAllPermissions("ACCOUNTANT", [
                    PERMISSIONS.CUSTOMERS_VIEW,
                    PERMISSIONS.WORK_ORDERS_CREATE,
                ]),
            ).toBe(false);
        });
    });

    describe("2. Workspace Authorization Context & Guards (`lib/auth/authorization.ts`)", () => {
        const USER_ID = "user_auth_1";
        const WS_ID = "ws_auth_1";

        it("getAuthorizationContext enforces userId and workspaceId presence", async () => {
            await expect(getAuthorizationContext("", WS_ID)).rejects.toThrow(UnauthorizedError);
            await expect(getAuthorizationContext(USER_ID, "")).rejects.toThrow(WorkspaceAccessError);
        });

        it("getAuthorizationContext throws WorkspaceAccessError when membership is missing or inactive", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);
            await expect(getAuthorizationContext(USER_ID, WS_ID)).rejects.toThrow(WorkspaceAccessError);
        });

        it("getAuthorizationContext returns valid context for active member", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: USER_ID,
                workspaceId: WS_ID,
                role: "MANAGER",
            });

            const ctx = await getAuthorizationContext(USER_ID, WS_ID);
            expect(ctx.userId).toBe(USER_ID);
            expect(ctx.workspaceId).toBe(WS_ID);
            expect(ctx.role).toBe("MANAGER");
        });

        it("getUserPermissions resolves all permissions for user membership", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: USER_ID,
                workspaceId: WS_ID,
                role: "DISPATCHER",
            });

            const perms = await getUserPermissions(USER_ID, WS_ID);
            expect(perms).toEqual(ROLE_PERMISSIONS.DISPATCHER);
        });

        it("hasPermission returns boolean without throwing on invalid args or missing membership", async () => {
            expect(await hasPermission("", WS_ID, PERMISSIONS.CUSTOMERS_VIEW)).toBe(false);
            expect(await hasPermission(USER_ID, "", PERMISSIONS.CUSTOMERS_VIEW)).toBe(false);

            mocks.prisma.workspaceMember.findFirst.mockResolvedValueOnce(null);
            expect(await hasPermission(USER_ID, WS_ID, PERMISSIONS.CUSTOMERS_VIEW)).toBe(false);

            mocks.prisma.workspaceMember.findFirst.mockResolvedValueOnce({ role: "TECHNICIAN" });
            expect(await hasPermission(USER_ID, WS_ID, PERMISSIONS.WORK_ORDERS_COMPLETE)).toBe(true);

            mocks.prisma.workspaceMember.findFirst.mockResolvedValueOnce({ role: "TECHNICIAN" });
            expect(await hasPermission(USER_ID, WS_ID, PERMISSIONS.BILLING_MANAGE)).toBe(false);
        });

        it("requirePermission validates single permission requirement", async () => {
            await expect(requirePermission("", WS_ID, PERMISSIONS.CUSTOMERS_VIEW)).rejects.toThrow(
                UnauthorizedError,
            );
            await expect(requirePermission(USER_ID, "", PERMISSIONS.CUSTOMERS_VIEW)).rejects.toThrow(
                WorkspaceAccessError,
            );

            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: USER_ID,
                workspaceId: WS_ID,
                role: "TECHNICIAN",
            });

            // Permitted
            const ctx = await requirePermission(USER_ID, WS_ID, PERMISSIONS.WORK_ORDERS_COMPLETE);
            expect(ctx.role).toBe("TECHNICIAN");

            // Forbidden
            await expect(
                requirePermission(USER_ID, WS_ID, PERMISSIONS.BILLING_MANAGE),
            ).rejects.toThrow(ForbiddenError);
        });

        it("requireAnyPermission validates array of permissions and rejects empty lists", async () => {
            await expect(requireAnyPermission("", WS_ID, [PERMISSIONS.CUSTOMERS_VIEW])).rejects.toThrow(
                UnauthorizedError,
            );
            await expect(requireAnyPermission(USER_ID, "", [PERMISSIONS.CUSTOMERS_VIEW])).rejects.toThrow(
                WorkspaceAccessError,
            );
            // Empty list must throw ForbiddenError
            await expect(requireAnyPermission(USER_ID, WS_ID, [])).rejects.toThrow(ForbiddenError);

            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: USER_ID,
                workspaceId: WS_ID,
                role: "DISPATCHER",
            });

            // At least one matches
            const ctx = await requireAnyPermission(USER_ID, WS_ID, [
                PERMISSIONS.BILLING_MANAGE,
                PERMISSIONS.SCHEDULER_CREATE,
            ]);
            expect(ctx.role).toBe("DISPATCHER");

            // None match
            await expect(
                requireAnyPermission(USER_ID, WS_ID, [
                    PERMISSIONS.BILLING_MANAGE,
                    PERMISSIONS.MEMBERS_INVITE,
                ]),
            ).rejects.toThrow(ForbiddenError);
        });

        it("requireAllPermissions requires every permission and rejects empty lists", async () => {
            await expect(requireAllPermissions("", WS_ID, [PERMISSIONS.CUSTOMERS_VIEW])).rejects.toThrow(
                UnauthorizedError,
            );
            await expect(requireAllPermissions(USER_ID, "", [PERMISSIONS.CUSTOMERS_VIEW])).rejects.toThrow(
                WorkspaceAccessError,
            );
            // Empty list must throw ForbiddenError
            await expect(requireAllPermissions(USER_ID, WS_ID, [])).rejects.toThrow(ForbiddenError);

            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: USER_ID,
                workspaceId: WS_ID,
                role: "ADMIN",
            });

            // All match
            const ctx = await requireAllPermissions(USER_ID, WS_ID, [
                PERMISSIONS.CUSTOMERS_CREATE,
                PERMISSIONS.BILLING_MANAGE,
            ]);
            expect(ctx.role).toBe("ADMIN");

            // One missing
            await expect(
                requireAllPermissions(USER_ID, WS_ID, [
                    PERMISSIONS.CUSTOMERS_CREATE,
                    "NON_EXISTENT_PERM" as any,
                ]),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("3. Extended Role Hierarchy (`lib/services/authorization/roleHierarchy.ts`)", () => {
        it("verifies hierarchical integer ordering across all 6 roles", () => {
            expect(ROLE_HIERARCHY.OWNER).toBe(600);
            expect(ROLE_HIERARCHY.ADMIN).toBe(500);
            expect(ROLE_HIERARCHY.MANAGER).toBe(400);
            expect(ROLE_HIERARCHY.DISPATCHER).toBe(300);
            expect(ROLE_HIERARCHY.TECHNICIAN).toBe(200);
            expect(ROLE_HIERARCHY.ACCOUNTANT).toBe(100);
        });

        it("roleIsHigherThan validates relative seniority for DISPATCHER and ACCOUNTANT", () => {
            expect(roleIsHigherThan("DISPATCHER", "TECHNICIAN")).toBe(true);
            expect(roleIsHigherThan("DISPATCHER", "ACCOUNTANT")).toBe(true);
            expect(roleIsHigherThan("MANAGER", "DISPATCHER")).toBe(true);

            expect(roleIsHigherThan("TECHNICIAN", "DISPATCHER")).toBe(false);
            expect(roleIsHigherThan("ACCOUNTANT", "TECHNICIAN")).toBe(false);
            expect(roleIsHigherThan("DISPATCHER", "DISPATCHER")).toBe(false);
        });

        it("roleHasMinimumLevel verifies threshold inclusion for DISPATCHER and ACCOUNTANT", () => {
            expect(roleHasMinimumLevel("DISPATCHER", "DISPATCHER")).toBe(true);
            expect(roleHasMinimumLevel("DISPATCHER", "TECHNICIAN")).toBe(true);
            expect(roleHasMinimumLevel("DISPATCHER", "ACCOUNTANT")).toBe(true);
            expect(roleHasMinimumLevel("DISPATCHER", "MANAGER")).toBe(false);

            expect(roleHasMinimumLevel("ACCOUNTANT", "ACCOUNTANT")).toBe(true);
            expect(roleHasMinimumLevel("ACCOUNTANT", "TECHNICIAN")).toBe(false);
        });
    });
});
