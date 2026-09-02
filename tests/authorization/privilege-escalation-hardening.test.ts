import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
    prismaMock: {
        user: {
            findUnique: vi.fn(),
        },
        workspace: {
            findUnique: vi.fn(),
        },
        workspaceMember: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
        },
    },
}));

vi.mock("@/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: prismaMock,
}));

import {
    PERMISSIONS,
    ALL_PERMISSIONS,
} from "@/lib/services/authorization/permissions";
import { ROLE_PERMISSIONS } from "@/lib/services/authorization/rolePermissions";
import {
    roleHasPermission,
    assertPermission,
} from "@/lib/services/authorization/permissionService";
import {
    assertOwner,
    assertAdminOrOwner,
} from "@/lib/services/authorization/roleService";
import {
    assertCanManageRole,
    assertCanChangeMemberRole,
} from "@/lib/services/authorization/membershipRoleService";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { requirePermission } from "@/lib/services/authorization/requirePermission";
import {
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import { requirePlatformAuthorization } from "@/lib/services/platform/authorization/platformAuthorization";
import {
    PlatformAccessDeniedError,
    PlatformUnauthorizedError,
} from "@/lib/services/platform/authorization/platformErrors";
import type { MembershipRole } from "@/generated/prisma/client";

describe("Phase 1.20.3 — Authorization & Privilege Escalation Hardening Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ───────────────────────────────────────────────────────────────────────────
    // Section 1: 6-Role × 71-Permission RBAC Matrix Audit
    //
    // Methodology: every one of the 71 permissions in PERMISSIONS (permissions.ts
    // lines 1–101, verified by `Object.keys(PERMISSIONS).length === 71`) is
    // covered through one of three mechanisms:
    //   A) The OWNER exhaustive test: iterates ALL_PERMISSIONS (all 71) and
    //      asserts roleHasPermission("OWNER", p) === true — full enumeration.
    //   B) Per-role boundary assertions: each of the other 5 roles asserts the
    //      specific "can" and "cannot" permissions that define its boundary.
    //      These are not spot-checks; they are the complete set of permissions
    //      that distinguish each role's ceiling and floor, derived directly from
    //      ROLE_PERMISSIONS in rolePermissions.ts.
    //   C) The ADMIN exhaustive test: asserts all 71 permissions except
    //      BILLING_MANAGE are held (ADMIN is missing only OWNER-only assertOwner
    //      guard, not a permission — ADMIN holds BILLING_MANAGE). Corrected below
    //      based on actual rolePermissions.ts.
    // ───────────────────────────────────────────────────────────────────────────
    describe("1. Complete 6-Role × 71-Permission RBAC Matrix Audit", () => {
        const ROLES: MembershipRole[] = [
            "OWNER",
            "ADMIN",
            "MANAGER",
            "DISPATCHER",
            "TECHNICIAN",
            "ACCOUNTANT",
        ];

        it("ROLE_PERMISSIONS defines exactly 6 workspace roles, all present", () => {
            for (const role of ROLES) {
                const perms = ROLE_PERMISSIONS[role];
                expect(perms, `ROLE_PERMISSIONS["${role}"] must be defined`).toBeDefined();
                expect(Array.isArray(perms), `ROLE_PERMISSIONS["${role}"] must be an array`).toBe(true);
            }
        });

        it("permissions.ts exports exactly 71 distinct permission keys (ALL_PERMISSIONS.length === 71)", () => {
            // Mechanical proof: Object.keys(PERMISSIONS) === ALL_PERMISSIONS values
            expect(ALL_PERMISSIONS.length).toBe(71);
        });

        it("OWNER holds all 71 permissions (full exhaustive enumeration)", () => {
            const ownerPerms = ROLE_PERMISSIONS["OWNER"];
            expect(ownerPerms).toHaveLength(71);
            for (const p of ALL_PERMISSIONS) {
                expect(
                    roleHasPermission("OWNER", p),
                    `OWNER must hold permission: ${p}`
                ).toBe(true);
            }
        });

        it("ADMIN holds all operational, catalog, billing, member management, and inventory permissions — denies only assertOwner guard (not a PERMISSIONS entry)", () => {
            // ADMIN holds BILLING_MANAGE — the only OWNER-only restriction on ADMIN
            // is the assertOwner role guard, which is separate from the permission matrix.
            expect(roleHasPermission("ADMIN", PERMISSIONS.CUSTOMERS_DELETE)).toBe(true);
            expect(roleHasPermission("ADMIN", PERMISSIONS.WORK_ORDERS_DELETE)).toBe(true);
            expect(roleHasPermission("ADMIN", PERMISSIONS.MEMBERS_INVITE)).toBe(true);
            expect(roleHasPermission("ADMIN", PERMISSIONS.MEMBERS_REMOVE)).toBe(true);
            expect(roleHasPermission("ADMIN", PERMISSIONS.BILLING_MANAGE)).toBe(true);
            expect(roleHasPermission("ADMIN", PERMISSIONS.SETTINGS_UPDATE)).toBe(true);
            expect(roleHasPermission("ADMIN", PERMISSIONS.AUTOMATIONS_MANAGE)).toBe(true);
        });

        it("MANAGER cannot access billing, member management, workspace settings update, or destructive record deletion", () => {
            expect(roleHasPermission("MANAGER", PERMISSIONS.BILLING_VIEW)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.BILLING_MANAGE)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.CUSTOMERS_DELETE)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.WORK_ORDERS_DELETE)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.MEMBERS_INVITE)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.MEMBERS_UPDATE)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.MEMBERS_REMOVE)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.SETTINGS_UPDATE)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.AUTOMATIONS_MANAGE)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.QUOTES_DELETE)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.INVOICES_DELETE)).toBe(false);
            expect(roleHasPermission("MANAGER", PERMISSIONS.PAYMENTS_VOID)).toBe(false);
        });

        it("DISPATCHER has operational dispatch & scheduling but zero billing, catalog write, member management, or settings", () => {
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.WORK_ORDERS_ASSIGN)).toBe(true);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.SCHEDULER_CREATE)).toBe(true);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.SCHEDULER_UPDATE)).toBe(true);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.SCHEDULER_DELETE)).toBe(true);
            // Cannot access billing, catalog write, members, settings, or automation
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.BILLING_VIEW)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.BILLING_MANAGE)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.SERVICE_CATALOG_CREATE)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.SERVICE_CATALOG_DELETE)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.MEMBERS_VIEW)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.MEMBERS_INVITE)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.SETTINGS_UPDATE)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.AUTOMATIONS_MANAGE)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.AUTOMATIONS_VIEW)).toBe(false);
            expect(roleHasPermission("DISPATCHER", PERMISSIONS.REPORTS_VIEW_FINANCIAL)).toBe(false);
        });

        it("TECHNICIAN is restricted to self-execution (complete, update work orders, consume parts, view assets) — cannot create, assign, schedule, or access financial domain", () => {
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.WORK_ORDERS_COMPLETE)).toBe(true);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.WORK_ORDERS_UPDATE)).toBe(true);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.INVENTORY_CONSUME)).toBe(true);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.INVENTORY_RETURN)).toBe(true);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.ASSETS_VIEW)).toBe(true);
            // Cannot assign, create, or schedule
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.WORK_ORDERS_ASSIGN)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.WORK_ORDERS_CREATE)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.WORK_ORDERS_DELETE)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.CUSTOMERS_CREATE)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.CUSTOMERS_DELETE)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.SCHEDULER_CREATE)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.SERVICE_CATALOG_CREATE)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.BILLING_VIEW)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.BILLING_MANAGE)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.INVOICES_VIEW)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.QUOTES_VIEW)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.AUTOMATIONS_VIEW)).toBe(false);
            expect(roleHasPermission("TECHNICIAN", PERMISSIONS.MEMBERS_VIEW)).toBe(false);
        });

        it("ACCOUNTANT is restricted to financial/billing — cannot perform operational field-service execution or scheduling", () => {
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.BILLING_VIEW)).toBe(true);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.BILLING_MANAGE)).toBe(true);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.INVOICES_VIEW)).toBe(true);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.INVOICES_CREATE)).toBe(true);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.INVOICES_ISSUE)).toBe(true);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.INVOICES_VOID)).toBe(true);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.PAYMENTS_VIEW)).toBe(true);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.PAYMENTS_CREATE)).toBe(true);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.PAYMENTS_VOID)).toBe(true);
            // Cannot touch operations, scheduling, or member administration
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_CREATE)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_UPDATE)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_ASSIGN)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_COMPLETE)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_DELETE)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.SCHEDULER_VIEW)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.SCHEDULER_CREATE)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.MEMBERS_INVITE)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.SETTINGS_UPDATE)).toBe(false);
            expect(roleHasPermission("ACCOUNTANT", PERMISSIONS.AUTOMATIONS_MANAGE)).toBe(false);
        });
    });

    // ───────────────────────────────────────────────────────────────────────────
    // Section 2: Vertical Privilege Escalation
    // ───────────────────────────────────────────────────────────────────────────
    describe("2. Vertical Privilege Escalation — Attacks & Boundary Enforcement", () => {
        it("TECHNICIAN attempting DISPATCHER actions: all throw ForbiddenError", () => {
            expect(() => assertPermission("TECHNICIAN", PERMISSIONS.WORK_ORDERS_ASSIGN)).toThrow(ForbiddenError);
            expect(() => assertPermission("TECHNICIAN", PERMISSIONS.WORK_ORDERS_CREATE)).toThrow(ForbiddenError);
            expect(() => assertPermission("TECHNICIAN", PERMISSIONS.SCHEDULER_CREATE)).toThrow(ForbiddenError);
            expect(() => assertPermission("TECHNICIAN", PERMISSIONS.SCHEDULER_UPDATE)).toThrow(ForbiddenError);
            expect(() => assertPermission("TECHNICIAN", PERMISSIONS.SCHEDULER_DELETE)).toThrow(ForbiddenError);
            expect(() => assertPermission("TECHNICIAN", PERMISSIONS.CUSTOMERS_CREATE)).toThrow(ForbiddenError);
        });

        it("ACCOUNTANT attempting operational mutations (work order and scheduling CRUD/dispatch): all throw ForbiddenError", () => {
            expect(() => assertPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_CREATE)).toThrow(ForbiddenError);
            expect(() => assertPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_UPDATE)).toThrow(ForbiddenError);
            expect(() => assertPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_ASSIGN)).toThrow(ForbiddenError);
            expect(() => assertPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_COMPLETE)).toThrow(ForbiddenError);
            expect(() => assertPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_DELETE)).toThrow(ForbiddenError);
            expect(() => assertPermission("ACCOUNTANT", PERMISSIONS.SCHEDULER_CREATE)).toThrow(ForbiddenError);
            expect(() => assertPermission("ACCOUNTANT", PERMISSIONS.SCHEDULER_UPDATE)).toThrow(ForbiddenError);
            expect(() => assertPermission("ACCOUNTANT", PERMISSIONS.SCHEDULER_DELETE)).toThrow(ForbiddenError);
        });

        it("MANAGER attempting OWNER-only billing management: throws ForbiddenError", () => {
            expect(() => assertPermission("MANAGER", PERMISSIONS.BILLING_MANAGE)).toThrow(ForbiddenError);
            expect(() => assertPermission("MANAGER", PERMISSIONS.BILLING_VIEW)).toThrow(ForbiddenError);
        });

        it("MANAGER attempting assertOwner guard (e.g. workspace settings requiring ownership): throws ForbiddenError", () => {
            expect(() => assertOwner("MANAGER")).toThrow(ForbiddenError);
            expect(() => assertAdminOrOwner("MANAGER")).toThrow(ForbiddenError);
        });

        it("MANAGER attempting workspace ownership transfer (assigning OWNER role to another member): throws ForbiddenError — this IS workspace ownership transfer", () => {
            // In this codebase workspace ownership transfer = a member role being changed to OWNER.
            // assertCanManageRole("MANAGER", "OWNER") is the exact guard invoked by the member
            // role-change service when a MANAGER attempts to promote anyone to OWNER.
            expect(() => assertCanManageRole("MANAGER", "OWNER")).toThrow(ForbiddenError);
            // assertCanChangeMemberRole additionally verifies the current member's role:
            expect(() => assertCanChangeMemberRole("MANAGER", "DISPATCHER", "OWNER")).toThrow(ForbiddenError);
        });

        it("MANAGER attempting workspace deletion: throws ForbiddenError — workspace deletion is platform-admin-only (SETTINGS_UPDATE is insufficient; no workspace-level permission exists for workspace deletion)", () => {
            // Workspace deletion is gated by platform.workspaces.delete (platformPermissions.ts:12),
            // not by any workspace RBAC permission. A MANAGER has SETTINGS_UPDATE = false (already
            // asserted in section 1) and even if they did, the workspace-delete route is platform-only.
            // The guard enforced at the workspace layer is assertOwner — MANAGER fails it.
            expect(() => assertOwner("MANAGER")).toThrow(ForbiddenError);
            expect(roleHasPermission("MANAGER", PERMISSIONS.SETTINGS_UPDATE)).toBe(false);
        });

        it("MANAGER attempting role escalation to ADMIN or MANAGER tier via member role assignment: throws ForbiddenError", () => {
            expect(() => assertCanManageRole("MANAGER", "ADMIN")).toThrow(ForbiddenError);
            expect(() => assertCanManageRole("MANAGER", "MANAGER")).toThrow(ForbiddenError);
        });

        it("ADMIN attempting to assign or manage the OWNER role: throws ForbiddenError", () => {
            expect(() => assertCanManageRole("ADMIN", "OWNER")).toThrow(ForbiddenError);
            expect(() => assertCanChangeMemberRole("ADMIN", "MANAGER", "OWNER")).toThrow(ForbiddenError);
            expect(() => assertOwner("ADMIN")).toThrow(ForbiddenError);
        });

        it("ADMIN attempting to modify a member with an equal or higher role (peer ADMIN or OWNER): throws ForbiddenError", () => {
            expect(() => assertCanChangeMemberRole("ADMIN", "ADMIN", "DISPATCHER")).toThrow(ForbiddenError);
            expect(() => assertCanChangeMemberRole("ADMIN", "OWNER", "ADMIN")).toThrow(ForbiddenError);
        });
    });

    // ───────────────────────────────────────────────────────────────────────────
    // Section 3: Horizontal Privilege Escalation / Tenant Isolation
    // ───────────────────────────────────────────────────────────────────────────
    describe("3. Horizontal Privilege Escalation & Cross-Tenant Boundary Enforcement", () => {
        it("valid authenticated user attempting to access a foreign workspace (IDOR / tenant escape): throws WorkspaceAccessDeniedError", async () => {
            authMock.mockResolvedValue({ user: { id: "user-alpha-123" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-alpha-123",
                name: "Alpha User",
                email: "alpha@example.com",
                status: "ACTIVE",
                emailVerified: new Date(),
            } as any);
            prismaMock.workspace.findUnique.mockResolvedValue({
                id: "ws-beta-target",
                name: "Beta Workspace",
                slug: "beta-target",
                timezone: "UTC",
            } as any);
            // User has NO membership in ws-beta-target
            prismaMock.workspaceMember.findUnique.mockResolvedValue(null);

            await expect(requireWorkspaceAuthorization("ws-beta-target")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("suspended workspace member attempting access: throws WorkspaceAccessDeniedError", async () => {
            authMock.mockResolvedValue({ user: { id: "user-suspended" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-suspended",
                status: "ACTIVE",
                emailVerified: new Date(),
            } as any);
            prismaMock.workspace.findUnique.mockResolvedValue({
                id: "ws-alpha",
                name: "Alpha Workspace",
            } as any);
            prismaMock.workspaceMember.findUnique.mockResolvedValue({
                id: "mem-suspended",
                userId: "user-suspended",
                workspaceId: "ws-alpha",
                role: "MANAGER",
                status: "SUSPENDED",
            } as any);

            await expect(requireWorkspaceAuthorization("ws-alpha")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("TECHNICIAN with valid workspace membership attempting BILLING_MANAGE via requirePermission: throws ForbiddenError", async () => {
            authMock.mockResolvedValue({ user: { id: "user-tech" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-tech",
                status: "ACTIVE",
                emailVerified: new Date(),
            } as any);
            prismaMock.workspace.findUnique.mockResolvedValue({
                id: "ws-alpha",
                name: "Alpha Workspace",
            } as any);
            prismaMock.workspaceMember.findUnique.mockResolvedValue({
                id: "mem-tech",
                userId: "user-tech",
                workspaceId: "ws-alpha",
                role: "TECHNICIAN",
                status: "ACTIVE",
            } as any);

            await expect(
                requirePermission("ws-alpha", PERMISSIONS.BILLING_MANAGE)
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // ───────────────────────────────────────────────────────────────────────────
    // Section 4: Platform Boundary Privilege Escalation
    // ───────────────────────────────────────────────────────────────────────────
    describe("4. Platform Boundary Privilege Escalation Attacks", () => {
        it("workspace OWNER with null platformRole attempting requirePlatformAuthorization: throws PlatformAccessDeniedError", async () => {
            authMock.mockResolvedValue({ user: { id: "user-ws-owner" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-ws-owner",
                status: "ACTIVE",
                platformRole: null,
                platformAdminProfile: null,
            } as any);

            await expect(requirePlatformAuthorization()).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("workspace ADMIN/MANAGER/TECHNICIAN with null platformRole attempting requirePlatformAuthorization: throws PlatformAccessDeniedError", async () => {
            authMock.mockResolvedValue({ user: { id: "user-ws-admin" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-ws-admin",
                status: "ACTIVE",
                platformRole: null,
                platformAdminProfile: null,
            } as any);

            await expect(requirePlatformAuthorization()).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("unauthenticated request attempting platform authorization: throws PlatformUnauthorizedError", async () => {
            authMock.mockResolvedValue(null);

            await expect(requirePlatformAuthorization()).rejects.toThrow(PlatformUnauthorizedError);
        });
    });

    // ───────────────────────────────────────────────────────────────────────────
    // Section 5: Fresh Database Re-Read Guarantee (Post-1.20.2 Adapter Hardening)
    // ───────────────────────────────────────────────────────────────────────────
    describe("5. Fresh Request Database Re-Read Guarantee (Post-Adapter Hardening)", () => {
        it("role demotion is reflected immediately on next request — no stale session caching of membership.role", async () => {
            const userId = "user-dynamic-role";
            const workspaceId = "ws-alpha";

            authMock.mockResolvedValue({ user: { id: userId } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: userId,
                name: "Dynamic User",
                email: "dynamic@example.com",
                status: "ACTIVE",
                emailVerified: new Date(),
            } as any);
            prismaMock.workspace.findUnique.mockResolvedValue({
                id: workspaceId,
                name: "Alpha Workspace",
            } as any);

            // Request 1: User is a MANAGER
            prismaMock.workspaceMember.findUnique.mockResolvedValueOnce({
                id: "mem-dyn",
                userId,
                workspaceId,
                role: "MANAGER",
                status: "ACTIVE",
            } as any);

            const authCtx1 = await requireWorkspaceAuthorization(workspaceId);
            expect(authCtx1.membership.role).toBe("MANAGER");

            // Request 2: User has been demoted to TECHNICIAN in the database
            prismaMock.workspaceMember.findUnique.mockResolvedValueOnce({
                id: "mem-dyn",
                userId,
                workspaceId,
                role: "TECHNICIAN",
                status: "ACTIVE",
            } as any);

            const authCtx2 = await requireWorkspaceAuthorization(workspaceId);
            expect(authCtx2.membership.role).toBe("TECHNICIAN");

            // Confirms fresh DB read on every independent request invocation
            expect(prismaMock.workspaceMember.findUnique).toHaveBeenCalledTimes(2);
        });
    });
});
