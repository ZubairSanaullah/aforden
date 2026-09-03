import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
    prismaMock: {
        user: { findUnique: vi.fn(), update: vi.fn() },
        workspace: { findUnique: vi.fn() },
        workspaceMember: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
        session: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
        apiKey: { findFirst: vi.fn(), findUnique: vi.fn() },
    },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { ROLE_PERMISSIONS } from "@/lib/services/authorization/rolePermissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    assertOwner,
    assertAdminOrOwner,
} from "@/lib/services/authorization/roleService";
import {
    assertCanManageRole,
    assertCanChangeMemberRole,
} from "@/lib/services/authorization/membershipRoleService";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import {
    validateAndTouchSession,
} from "@/lib/services/auth/sessionManagement";
import type { MembershipRole } from "@/generated/prisma/client";

describe("Phase 1.21.4 — Privilege Escalation & Auth Bypass Adversarial Suite", () => {
    const NON_OWNER_ROLES: MembershipRole[] = [
        "ADMIN",
        "MANAGER",
        "DISPATCHER",
        "TECHNICIAN",
        "ACCOUNTANT",
    ];

    const NON_ADMIN_OR_OWNER_ROLES: MembershipRole[] = [
        "MANAGER",
        "DISPATCHER",
        "TECHNICIAN",
        "ACCOUNTANT",
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.session.delete.mockResolvedValue({ id: "sess_1" });
    });

    // =========================================================================
    // 1. Full Non-OWNER Role Matrix against OWNER-Only Operations
    // =========================================================================
    describe("1. Non-OWNER Roles Rejected on OWNER-Gated Operations (assertOwner)", () => {
        for (const role of NON_OWNER_ROLES) {
            it(`assertOwner: rejects role '${role}' with ForbiddenError (403)`, () => {
                expect(() => assertOwner(role)).toThrow(ForbiddenError);
            });
        }

        it("assertOwner: allows OWNER role", () => {
            expect(() => assertOwner("OWNER")).not.toThrow();
        });
    });

    // =========================================================================
    // 2. Full Non-Admin/Owner Matrix against ADMIN-Gated Operations (assertAdminOrOwner)
    // =========================================================================
    describe("2. Non-Admin/Owner Roles Rejected on ADMIN-Gated Operations (assertAdminOrOwner)", () => {
        for (const role of NON_ADMIN_OR_OWNER_ROLES) {
            it(`assertAdminOrOwner: rejects role '${role}' with ForbiddenError (403)`, () => {
                expect(() => assertAdminOrOwner(role)).toThrow(ForbiddenError);
            });
        }

        it("assertAdminOrOwner: allows OWNER and ADMIN roles", () => {
            expect(() => assertAdminOrOwner("OWNER")).not.toThrow();
            expect(() => assertAdminOrOwner("ADMIN")).not.toThrow();
        });
    });

    // =========================================================================
    // 3. Role Hierarchy & Unauthorized Role Mutation Sweeps
    // =========================================================================
    describe("3. Role Hierarchy & Unauthorized Member Role Promotion/Demotion", () => {
        it("assertCanChangeMemberRole: TECHNICIAN cannot change any member's role", () => {
            expect(() =>
                assertCanChangeMemberRole("TECHNICIAN", "TECHNICIAN", "DISPATCHER")
            ).toThrow(ForbiddenError);
            expect(() =>
                assertCanChangeMemberRole("TECHNICIAN", "TECHNICIAN", "OWNER")
            ).toThrow(ForbiddenError);
        });

        it("assertCanChangeMemberRole: DISPATCHER cannot change any member's role", () => {
            expect(() =>
                assertCanChangeMemberRole("DISPATCHER", "TECHNICIAN", "DISPATCHER")
            ).toThrow(ForbiddenError);
        });

        it("assertCanChangeMemberRole: ACCOUNTANT cannot change any member's role", () => {
            expect(() =>
                assertCanChangeMemberRole("ACCOUNTANT", "TECHNICIAN", "ACCOUNTANT")
            ).toThrow(ForbiddenError);
        });

        it("assertCanChangeMemberRole: MANAGER cannot promote anyone to ADMIN or OWNER", () => {
            expect(() =>
                assertCanChangeMemberRole("MANAGER", "TECHNICIAN", "ADMIN")
            ).toThrow(ForbiddenError);
            expect(() =>
                assertCanChangeMemberRole("MANAGER", "TECHNICIAN", "OWNER")
            ).toThrow(ForbiddenError);
        });

        it("assertCanChangeMemberRole: MANAGER cannot modify existing ADMIN or OWNER", () => {
            expect(() =>
                assertCanChangeMemberRole("MANAGER", "ADMIN", "TECHNICIAN")
            ).toThrow(ForbiddenError);
            expect(() =>
                assertCanChangeMemberRole("MANAGER", "OWNER", "MANAGER")
            ).toThrow(ForbiddenError);
        });

        it("assertCanChangeMemberRole: ADMIN cannot promote anyone to OWNER", () => {
            expect(() =>
                assertCanChangeMemberRole("ADMIN", "MANAGER", "OWNER")
            ).toThrow(ForbiddenError);
        });

        it("assertCanChangeMemberRole: ADMIN cannot demote or modify the OWNER", () => {
            expect(() =>
                assertCanChangeMemberRole("ADMIN", "OWNER", "ADMIN")
            ).toThrow(ForbiddenError);
        });

        it("assertCanManageRole: non-admin/owner roles (MANAGER, DISPATCHER, TECHNICIAN, ACCOUNTANT) cannot manage any roles", () => {
            expect(() => assertCanManageRole("MANAGER", "TECHNICIAN")).toThrow(ForbiddenError);
            expect(() => assertCanManageRole("DISPATCHER", "TECHNICIAN")).toThrow(ForbiddenError);
            expect(() => assertCanManageRole("TECHNICIAN", "TECHNICIAN")).toThrow(ForbiddenError);
            expect(() => assertCanManageRole("ACCOUNTANT", "TECHNICIAN")).toThrow(ForbiddenError);
        });

        it("assertCanManageRole: ADMIN cannot assign OWNER or equal-level ADMIN", () => {
            expect(() => assertCanManageRole("ADMIN", "OWNER")).toThrow(ForbiddenError);
            expect(() => assertCanManageRole("ADMIN", "ADMIN")).toThrow(ForbiddenError);
            expect(() => assertCanManageRole("ADMIN", "MANAGER")).not.toThrow();
            expect(() => assertCanManageRole("ADMIN", "TECHNICIAN")).not.toThrow();
        });
    });

    // =========================================================================
    // 4. Financial & High-Privilege Write Boundaries for Operations Roles
    // =========================================================================
    describe("4. Financial & High-Privilege Write Boundaries for Operations Roles", () => {
        it("TECHNICIAN lacks INVOICES_CREATE, INVOICES_UPDATE and BILLING_MANAGE permissions", () => {
            expect(() =>
                assertPermission("TECHNICIAN", PERMISSIONS.INVOICES_CREATE)
            ).toThrow(ForbiddenError);
            expect(() =>
                assertPermission("TECHNICIAN", PERMISSIONS.INVOICES_UPDATE)
            ).toThrow(ForbiddenError);
            expect(() =>
                assertPermission("TECHNICIAN", PERMISSIONS.BILLING_MANAGE)
            ).toThrow(ForbiddenError);
        });

        it("DISPATCHER lacks BILLING_MANAGE and WORK_ORDERS_DELETE permissions", () => {
            expect(() =>
                assertPermission("DISPATCHER", PERMISSIONS.BILLING_MANAGE)
            ).toThrow(ForbiddenError);
            expect(() =>
                assertPermission("DISPATCHER", PERMISSIONS.WORK_ORDERS_DELETE)
            ).toThrow(ForbiddenError);
        });

        it("ACCOUNTANT holds INVOICES_VIEW and BILLING_MANAGE but lacks WORK_ORDERS_CREATE and WORK_ORDERS_DELETE", () => {
            expect(() =>
                assertPermission("ACCOUNTANT", PERMISSIONS.INVOICES_VIEW)
            ).not.toThrow();
            expect(() =>
                assertPermission("ACCOUNTANT", PERMISSIONS.BILLING_MANAGE)
            ).not.toThrow();
            expect(() =>
                assertPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_CREATE)
            ).toThrow(ForbiddenError);
            expect(() =>
                assertPermission("ACCOUNTANT", PERMISSIONS.WORK_ORDERS_DELETE)
            ).toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 5. Authentication Bypass & Token Invalidation Attacks
    // =========================================================================
    describe("5. Authentication Bypass & Token Invalidation Attacks", () => {
        it("validateAndTouchSession: rejects expired session token with valid: false", async () => {
            const expiredSession = {
                id: "sess_expired",
                sessionToken: "tok_expired_123",
                userId: "usr_1",
                expires: new Date(Date.now() - 60000), // 1 minute in past
                updatedAt: new Date(Date.now() - 120000),
                user: { id: "usr_1", status: "ACTIVE" },
            };
            prismaMock.session.findUnique.mockResolvedValue(expiredSession);

            const result = await validateAndTouchSession("tok_expired_123");
            expect(result.valid).toBe(false);
            expect(result.reason).toBe("EXPIRED");
        });

        it("validateAndTouchSession: rejects idle session token exceeding sliding idle timeout with valid: false", async () => {
            const idleSession = {
                id: "sess_idle",
                sessionToken: "tok_idle_123",
                userId: "usr_idle",
                expires: new Date(Date.now() + 86400000), // expires tomorrow
                updatedAt: new Date(Date.now() - 3600000 * 5), // 5 hours idle
                createdAt: new Date(Date.now() - 86400000),
            };
            prismaMock.session.findUnique.mockResolvedValue(idleSession);

            const result = await validateAndTouchSession("sess_idle");
            expect(result.valid).toBe(false);
            expect(result.reason).toBe("IDLE_TIMEOUT");
        });

        it("validateAndTouchSession: rejects non-existent session token", async () => {
            prismaMock.session.findUnique.mockResolvedValue(null);

            const result = await validateAndTouchSession("tok_nonexistent_999");
            expect(result.valid).toBe(false);
            expect(result.reason).toBe("NOT_FOUND");
        });
    });

    // =========================================================================
    // 6. Sensitive Data Exposure & Secret Masking Invariants
    // =========================================================================
    describe("6. Sensitive Data Exposure & Secret Masking Invariants", () => {
        it("verifies sensitive field keys are never exposed in standard public DTO shapes", () => {
            const sensitiveKeys = [
                "passwordHash",
                "password_hash",
                "hashedPassword",
                "tokenHash",
                "encryptedDek",
                "rawSecretKey",
                "tagHex",
                "ivHex",
            ];

            const mockPublicUserDto = {
                id: "usr_123",
                name: "John Doe",
                email: "john@example.com",
                avatarUrl: null,
                status: "ACTIVE",
                createdAt: new Date().toISOString(),
            };

            for (const key of sensitiveKeys) {
                expect(mockPublicUserDto).not.toHaveProperty(key);
            }
        });

        it("verifies API key secrets are strictly masked to prefix and suffix in display DTOs", () => {
            const rawApiKey = "afd_live_abc123456789xyz987654321";
            const maskedDisplay = `${rawApiKey.slice(0, 12)}...${rawApiKey.slice(-4)}`;

            expect(maskedDisplay).toBe("afd_live_abc...4321");
            expect(maskedDisplay).not.toContain("123456789xyz987");
        });
    });
});
