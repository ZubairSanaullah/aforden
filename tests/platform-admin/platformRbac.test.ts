import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import {
    PlatformRole,
    PlatformAdminStatus,
    PlatformAuthorizationContext,
    PLATFORM_PERMISSIONS,
    PlatformPermission,
    PLATFORM_ROLE_PERMISSIONS,
    platformRoleHasPermission,
    platformRoleHasAnyPermission,
    platformRoleHasAllPermissions,
    hasPlatformPermission,
    hasAnyPlatformPermission,
    hasAllPlatformPermissions,
    assertPlatformPermission,
    assertAnyPlatformPermission,
    assertAllPlatformPermissions,
    PlatformAccessDeniedError,
} from "@/lib/services/platform/authorization";
import { prisma } from "@/lib/prisma";

describe("Phase 1.19.3 — Platform RBAC Specification & Matrix Suite", () => {
    // Canonical Expected Matrix from Phase 1.19.1 Section 2.3
    const LOCKED_MATRIX: Record<PlatformPermission, Record<PlatformRole, boolean>> = {
        [PLATFORM_PERMISSIONS.WORKSPACES_VIEW]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: true,
            PLATFORM_OPERATIONS: true,
            PLATFORM_SECURITY: true,
            PLATFORM_BILLING: true,
        },
        [PLATFORM_PERMISSIONS.WORKSPACES_CREATE]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.WORKSPACES_UPDATE]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.WORKSPACES_SUSPEND]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.WORKSPACES_DELETE]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: false,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.WORKSPACES_SUPPORT_VIEW]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: true,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: true,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.BILLING_VIEW]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: true,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: true,
        },
        [PLATFORM_PERMISSIONS.BILLING_MANAGE_PLANS]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: true,
        },
        [PLATFORM_PERMISSIONS.BILLING_OVERRIDE_ENTITLEMENTS]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: true,
        },
        [PLATFORM_PERMISSIONS.BILLING_SYNC_GATEWAY]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: false,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: true,
        },
        [PLATFORM_PERMISSIONS.OPERATORS_VIEW]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: true,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.OPERATORS_INVITE]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: false,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.OPERATORS_UPDATE_ROLE]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: false,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.OPERATORS_REVOKE]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: false,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.CONFIG_VIEW]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: true,
            PLATFORM_OPERATIONS: true,
            PLATFORM_SECURITY: true,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.CONFIG_UPDATE_SETTINGS]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: true,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.DEVELOPER_VIEW_APPS]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: true,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: true,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.DEVELOPER_REVOKE_KEYS]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: true,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.DEVELOPER_MANAGE_WEBHOOKS]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: true,
            PLATFORM_SECURITY: true,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.OPERATIONS_VIEW_QUEUES]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: true,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.OPERATIONS_RETRY_JOBS]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: true,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.OPERATIONS_PURGE_STALE]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: false,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: true,
            PLATFORM_SECURITY: false,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.AUDIT_VIEW]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: true,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: true,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.SECURITY_INSPECT_SESSIONS]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: false,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: true,
            PLATFORM_BILLING: false,
        },
        [PLATFORM_PERMISSIONS.SECURITY_TERMINATE_SESSIONS]: {
            PLATFORM_OWNER: true,
            PLATFORM_ADMIN: false,
            PLATFORM_SUPPORT: false,
            PLATFORM_OPERATIONS: false,
            PLATFORM_SECURITY: true,
            PLATFORM_BILLING: false,
        },
    };

    const roles = Object.values(PlatformRole);
    const permissions = Object.values(PLATFORM_PERMISSIONS);

    function createMockContext(role: PlatformRole): PlatformAuthorizationContext {
        return {
            userId: `usr_${role.toLowerCase()}`,
            email: `${role.toLowerCase()}@aforden.com`,
            name: `${role} Operator`,
            avatarUrl: null,
            platformRole: role,
            profileId: `prof_${role.toLowerCase()}`,
            status: PlatformAdminStatus.ACTIVE,
            lastActiveAt: new Date(),
            lastLoginAt: new Date(),
            stepUpConfirmedAt: null,
            metadata: null,
        };
    }

    describe("1. Exhaustive Parameterized Role-to-Permission Matrix Evaluation", () => {
        it("verifies taxonomy contains exactly 26 concrete permissions", () => {
            expect(permissions.length).toBe(26);
        });

        it("verifies all 6 platform roles exist in the matrix data table", () => {
            expect(Object.keys(PLATFORM_ROLE_PERMISSIONS)).toHaveLength(6);
            for (const role of roles) {
                expect(PLATFORM_ROLE_PERMISSIONS[role]).toBeDefined();
            }
        });

        // Exhaustive 156-pair parameterized matrix assertion
        for (const role of Object.values(PlatformRole)) {
            for (const permission of Object.values(PLATFORM_PERMISSIONS)) {
                const expected = LOCKED_MATRIX[permission][role];

                it(`role [${role}] -> permission [${permission}] must be [${expected ? "GRANTED" : "DENIED"}]`, () => {
                    const granted = platformRoleHasPermission(role, permission);
                    expect(granted).toBe(expected);

                    const context = createMockContext(role);
                    const contextGranted = hasPlatformPermission(context, permission);
                    expect(contextGranted).toBe(expected);

                    if (expected) {
                        expect(() => assertPlatformPermission(context, permission)).not.toThrow();
                        expect(() => assertPlatformPermission(role, permission)).not.toThrow();
                    } else {
                        expect(() => assertPlatformPermission(context, permission)).toThrow(PlatformAccessDeniedError);
                        expect(() => assertPlatformPermission(role, permission)).toThrow(PlatformAccessDeniedError);
                    }
                });
            }
        }
    });

    describe("2. Self-Escalation & Operator Management Invariants", () => {
        const sensitiveOperatorPermissions: PlatformPermission[] = [
            PLATFORM_PERMISSIONS.OPERATORS_INVITE,
            PLATFORM_PERMISSIONS.OPERATORS_UPDATE_ROLE,
            PLATFORM_PERMISSIONS.OPERATORS_REVOKE,
        ];

        it("grants operator management permissions ONLY to PLATFORM_OWNER", () => {
            for (const permission of sensitiveOperatorPermissions) {
                expect(platformRoleHasPermission(PlatformRole.PLATFORM_OWNER, permission)).toBe(true);
            }
        });

        it("strictly denies PLATFORM_ADMIN from invoking operator governance actions", () => {
            const adminContext = createMockContext(PlatformRole.PLATFORM_ADMIN);

            for (const permission of sensitiveOperatorPermissions) {
                expect(hasPlatformPermission(adminContext, permission)).toBe(false);
                expect(() => assertPlatformPermission(adminContext, permission)).toThrow(
                    PlatformAccessDeniedError
                );
            }
        });

        it("strictly denies all non-OWNER roles from horizontal or vertical privilege escalation", () => {
            const nonOwnerRoles: PlatformRole[] = [
                PlatformRole.PLATFORM_ADMIN,
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_SECURITY,
                PlatformRole.PLATFORM_BILLING,
            ];

            for (const role of nonOwnerRoles) {
                const context = createMockContext(role);
                for (const permission of sensitiveOperatorPermissions) {
                    expect(() => assertPlatformPermission(context, permission)).toThrow(
                        PlatformAccessDeniedError
                    );
                }
            }
        });
    });

    describe("3. Negative Space & Granular Boundary Isolation", () => {
        it("denies PLATFORM_BILLING from performing system operations or security management", () => {
            const billingContext = createMockContext(PlatformRole.PLATFORM_BILLING);

            expect(hasPlatformPermission(billingContext, PLATFORM_PERMISSIONS.OPERATIONS_RETRY_JOBS)).toBe(false);
            expect(hasPlatformPermission(billingContext, PLATFORM_PERMISSIONS.SECURITY_TERMINATE_SESSIONS)).toBe(false);
            expect(hasPlatformPermission(billingContext, PLATFORM_PERMISSIONS.WORKSPACES_DELETE)).toBe(false);
            expect(hasPlatformPermission(billingContext, PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS)).toBe(false);

            expect(() => assertPlatformPermission(billingContext, PLATFORM_PERMISSIONS.SECURITY_TERMINATE_SESSIONS)).toThrow(PlatformAccessDeniedError);
        });

        it("denies PLATFORM_SUPPORT from mutating workspaces, config, or billing plans", () => {
            const supportContext = createMockContext(PlatformRole.PLATFORM_SUPPORT);

            expect(hasPlatformPermission(supportContext, PLATFORM_PERMISSIONS.WORKSPACES_CREATE)).toBe(false);
            expect(hasPlatformPermission(supportContext, PLATFORM_PERMISSIONS.WORKSPACES_SUSPEND)).toBe(false);
            expect(hasPlatformPermission(supportContext, PLATFORM_PERMISSIONS.WORKSPACES_DELETE)).toBe(false);
            expect(hasPlatformPermission(supportContext, PLATFORM_PERMISSIONS.BILLING_MANAGE_PLANS)).toBe(false);
            expect(hasPlatformPermission(supportContext, PLATFORM_PERMISSIONS.CONFIG_UPDATE_SETTINGS)).toBe(false);

            expect(() => assertPlatformPermission(supportContext, PLATFORM_PERMISSIONS.WORKSPACES_DELETE)).toThrow(PlatformAccessDeniedError);
        });

        it("denies PLATFORM_SECURITY from modifying billing plans or purging operational queues", () => {
            const securityContext = createMockContext(PlatformRole.PLATFORM_SECURITY);

            expect(hasPlatformPermission(securityContext, PLATFORM_PERMISSIONS.BILLING_MANAGE_PLANS)).toBe(false);
            expect(hasPlatformPermission(securityContext, PLATFORM_PERMISSIONS.OPERATIONS_PURGE_STALE)).toBe(false);
            expect(hasPlatformPermission(securityContext, PLATFORM_PERMISSIONS.WORKSPACES_CREATE)).toBe(false);
        });
    });

    describe("4. Fail-Closed Behavior on Missing or Null Context", () => {
        it("returns false from hasPlatformPermission when context is null or undefined", () => {
            expect(hasPlatformPermission(null, PLATFORM_PERMISSIONS.WORKSPACES_VIEW)).toBe(false);
            expect(hasPlatformPermission(undefined, PLATFORM_PERMISSIONS.WORKSPACES_VIEW)).toBe(false);
        });

        it("throws PlatformAccessDeniedError from assertPlatformPermission when context is null or undefined", () => {
            expect(() => assertPlatformPermission(null, PLATFORM_PERMISSIONS.WORKSPACES_VIEW)).toThrow(
                PlatformAccessDeniedError
            );
            expect(() => assertPlatformPermission(undefined, PLATFORM_PERMISSIONS.WORKSPACES_VIEW)).toThrow(
                PlatformAccessDeniedError
            );
        });

        it("fails closed on multi-permission helpers when context is null", () => {
            const permissions = [
                PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
                PLATFORM_PERMISSIONS.CONFIG_VIEW,
            ];
            expect(hasAnyPlatformPermission(null, permissions)).toBe(false);
            expect(hasAllPlatformPermissions(null, permissions)).toBe(false);
            expect(() => assertAnyPlatformPermission(null, permissions)).toThrow(PlatformAccessDeniedError);
            expect(() => assertAllPlatformPermissions(null, permissions)).toThrow(PlatformAccessDeniedError);
        });
    });

    describe("5. Multi-Permission Logic Evaluation", () => {
        it("evaluates hasAnyPlatformPermission and assertAnyPlatformPermission correctly", () => {
            const supportContext = createMockContext(PlatformRole.PLATFORM_SUPPORT);

            // Support has WORKSPACES_VIEW, but NOT WORKSPACES_CREATE
            expect(
                hasAnyPlatformPermission(supportContext, [
                    PLATFORM_PERMISSIONS.WORKSPACES_CREATE,
                    PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
                ])
            ).toBe(true);

            expect(() =>
                assertAnyPlatformPermission(supportContext, [
                    PLATFORM_PERMISSIONS.WORKSPACES_CREATE,
                    PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
                ])
            ).not.toThrow();

            // Support has neither WORKSPACES_CREATE nor WORKSPACES_DELETE
            expect(
                hasAnyPlatformPermission(supportContext, [
                    PLATFORM_PERMISSIONS.WORKSPACES_CREATE,
                    PLATFORM_PERMISSIONS.WORKSPACES_DELETE,
                ])
            ).toBe(false);

            expect(() =>
                assertAnyPlatformPermission(supportContext, [
                    PLATFORM_PERMISSIONS.WORKSPACES_CREATE,
                    PLATFORM_PERMISSIONS.WORKSPACES_DELETE,
                ])
            ).toThrow(PlatformAccessDeniedError);
        });

        it("evaluates hasAllPlatformPermissions and assertAllPlatformPermissions correctly", () => {
            const adminContext = createMockContext(PlatformRole.PLATFORM_ADMIN);

            // Admin has both WORKSPACES_VIEW and WORKSPACES_CREATE
            expect(
                hasAllPlatformPermissions(adminContext, [
                    PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
                    PLATFORM_PERMISSIONS.WORKSPACES_CREATE,
                ])
            ).toBe(true);

            expect(() =>
                assertAllPlatformPermissions(adminContext, [
                    PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
                    PLATFORM_PERMISSIONS.WORKSPACES_CREATE,
                ])
            ).not.toThrow();

            // Admin has WORKSPACES_VIEW but NOT WORKSPACES_DELETE
            expect(
                hasAllPlatformPermissions(adminContext, [
                    PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
                    PLATFORM_PERMISSIONS.WORKSPACES_DELETE,
                ])
            ).toBe(false);

            expect(() =>
                assertAllPlatformPermissions(adminContext, [
                    PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
                    PLATFORM_PERMISSIONS.WORKSPACES_DELETE,
                ])
            ).toThrow(PlatformAccessDeniedError);
        });
    });

    describe("6. Pure Function Invariant Proof (Zero Database Calls)", () => {
        it("asserts permissions without making any Prisma database queries", () => {
            const userFindSpy = vi.spyOn(prisma.user, "findUnique");
            const profileFindSpy = vi.spyOn(prisma.platformAdminProfile, "findUnique");

            const context = createMockContext(PlatformRole.PLATFORM_ADMIN);

            assertPlatformPermission(context, PLATFORM_PERMISSIONS.WORKSPACES_VIEW);
            assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS);
            expect(hasPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_VIEW)).toBe(true);

            expect(userFindSpy).not.toHaveBeenCalled();
            expect(profileFindSpy).not.toHaveBeenCalled();
        });
    });
});
