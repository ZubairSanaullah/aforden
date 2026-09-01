import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock functions
const {
    userFindUniqueMock,
    userFindManyMock,
    userCountMock,
    userCreateMock,
    userUpdateMock,
    profileFindUniqueMock,
    profileUpdateMock,
    profileUpsertMock,
    profileCountMock,
    auditLogCreateMock,
    transactionMock,
} = vi.hoisted(() => ({
    userFindUniqueMock: vi.fn(),
    userFindManyMock: vi.fn(),
    userCountMock: vi.fn(),
    userCreateMock: vi.fn(),
    userUpdateMock: vi.fn(),
    profileFindUniqueMock: vi.fn(),
    profileUpdateMock: vi.fn(),
    profileUpsertMock: vi.fn(),
    profileCountMock: vi.fn(),
    auditLogCreateMock: vi.fn(),
    transactionMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: userFindUniqueMock,
            findMany: userFindManyMock,
            count: userCountMock,
            create: userCreateMock,
            update: userUpdateMock,
        },
        platformAdminProfile: {
            findUnique: profileFindUniqueMock,
            update: profileUpdateMock,
            upsert: profileUpsertMock,
            count: profileCountMock,
        },
        platformAuditLog: {
            create: auditLogCreateMock,
        },
        $transaction: transactionMock,
    },
}));

import {
    PlatformRole,
    PlatformAdminStatus,
    PlatformAuthorizationContext,
    PlatformAccessDeniedError,
} from "@/lib/services/platform/authorization";
import {
    getPlatformUsers,
    getPlatformUser,
    createPlatformUser,
    changePlatformRole,
    deactivatePlatformUser,
    updatePlatformUser,
    PlatformOperatorNotFoundError,
    PlatformOperatorConflictError,
    PlatformLastOwnerProtectionError,
    PlatformSelfModificationError,
    PlatformOperatorValidationError,
} from "@/lib/services/platform/operators";
import { PlatformActionValidationError } from "@/lib/services/platform/workspaces";
import { PLATFORM_AUDIT_EVENTS } from "@/lib/services/platform/audit";
import { Prisma } from "@/generated/prisma/client";


describe("Phase 1.19.8 — Platform User Administration Suite", () => {
    let mockUsersStore: any[];

    function createMockPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_OWNER,
        userId = `usr_${role.toLowerCase()}`
    ): PlatformAuthorizationContext {
        return {
            userId,
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

    function seedInitialUsers() {
        return [
            {
                id: "usr_owner_primary",
                email: "owner1@aforden.com",
                name: "Primary Owner",
                avatarUrl: "https://avatar.com/owner1.png",
                passwordHash: "secret_bcrypt_hash_never_leak",
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_OWNER,
                createdAt: new Date("2026-01-01T00:00:00Z"),
                updatedAt: new Date("2026-08-01T00:00:00Z"),
                platformAdminProfile: {
                    id: "prof_owner_1",
                    userId: "usr_owner_primary",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: new Date(),
                    lastLoginAt: new Date(),
                    metadata: { team: "Executive" },
                    createdAt: new Date("2026-01-01T00:00:00Z"),
                    updatedAt: new Date("2026-08-01T00:00:00Z"),
                },
            },
            {
                id: "usr_admin_bob",
                email: "admin_bob@aforden.com",
                name: "Bob Admin",
                avatarUrl: null,
                passwordHash: "secret_bcrypt_hash_never_leak",
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_ADMIN,
                createdAt: new Date("2026-02-01T00:00:00Z"),
                updatedAt: new Date("2026-08-10T00:00:00Z"),
                platformAdminProfile: {
                    id: "prof_admin_bob",
                    userId: "usr_admin_bob",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: new Date(),
                    lastLoginAt: new Date(),
                    metadata: { team: "Ops" },
                    createdAt: new Date("2026-02-01T00:00:00Z"),
                    updatedAt: new Date("2026-08-10T00:00:00Z"),
                },
            },
            {
                id: "usr_regular_client",
                email: "client@acme.com",
                name: "Regular Tenant User",
                avatarUrl: null,
                passwordHash: "secret_bcrypt_hash_never_leak",
                status: "ACTIVE",
                platformRole: null,
                createdAt: new Date("2026-03-01T00:00:00Z"),
                updatedAt: new Date("2026-08-15T00:00:00Z"),
                platformAdminProfile: null,
            },
        ];
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockUsersStore = seedInitialUsers();

        // Transaction mock simulating atomic execution with state backup & rollback
        transactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
            const backup = JSON.parse(JSON.stringify(mockUsersStore));
            const txClient = {
                user: {
                    findUnique: vi.fn().mockImplementation(async (args: any) => {
                        if (args?.where?.id) {
                            return mockUsersStore.find((u) => u.id === args.where.id) ?? null;
                        }
                        if (args?.where?.email) {
                            return mockUsersStore.find((u) => u.email === args.where.email) ?? null;
                        }
                        return null;
                    }),
                    create: vi.fn().mockImplementation(async (args: any) => {
                        userCreateMock(args);
                        const newUser = {
                            id: `usr_${Date.now()}`,
                            ...args.data,
                            platformAdminProfile: args.data.platformAdminProfile?.create
                                ? {
                                      id: `prof_${Date.now()}`,
                                      status: args.data.platformAdminProfile.create.status ?? PlatformAdminStatus.ACTIVE,
                                      metadata: args.data.platformAdminProfile.create.metadata ?? null,
                                      createdAt: new Date(),
                                      updatedAt: new Date(),
                                  }
                                : null,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        };
                        mockUsersStore.push(newUser);
                        return newUser;
                    }),
                    update: vi.fn().mockImplementation(async (args: any) => {
                        userUpdateMock(args);
                        const target = mockUsersStore.find((u) => u.id === args.where.id);
                        if (target) {
                            Object.assign(target, args.data);
                        }
                        return target;
                    }),
                },
                platformAdminProfile: {
                    update: vi.fn().mockImplementation(async (args: any) => {
                        profileUpdateMock(args);
                        for (const u of mockUsersStore) {
                            if (u.platformAdminProfile?.id === args.where.id) {
                                Object.assign(u.platformAdminProfile, args.data);
                                return u.platformAdminProfile;
                            }
                        }
                        return null;
                    }),
                    upsert: vi.fn().mockImplementation(async (args: any) => {
                        profileUpsertMock(args);
                        const target = mockUsersStore.find((u) => u.id === args.where.userId);
                        if (target) {
                            if (target.platformAdminProfile) {
                                Object.assign(target.platformAdminProfile, args.update);
                            } else {
                                target.platformAdminProfile = {
                                    id: `prof_${Date.now()}`,
                                    userId: target.id,
                                    status: args.create.status,
                                    metadata: args.create.metadata ?? null,
                                    createdAt: new Date(),
                                    updatedAt: new Date(),
                                };
                            }
                            return target.platformAdminProfile;
                        }
                        return null;
                    }),
                    count: vi.fn().mockImplementation(async (args: any) => {
                        profileCountMock(args);
                        let count = 0;
                        for (const u of mockUsersStore) {
                            if (
                                u.platformAdminProfile?.status === PlatformAdminStatus.ACTIVE &&
                                u.platformRole === PlatformRole.PLATFORM_OWNER &&
                                u.status === "ACTIVE"
                            ) {
                                count++;
                            }
                        }
                        return count;
                    }),
                },
                platformAuditLog: {
                    create: vi.fn().mockImplementation(async (args: any) => {
                        auditLogCreateMock(args);
                        return {
                            id: `audit_${Date.now()}`,
                            ...args.data,
                            createdAt: new Date(),
                        };
                    }),
                },
                passwordResetToken: {
                    create: vi.fn().mockImplementation(async (args: any) => ({
                        id: `prt_${Date.now()}`,
                        ...args.data,
                    })),
                    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
                },
            };


            try {
                return await callback(txClient);
            } catch (err) {
                mockUsersStore = backup;
                throw err;
            }
        });

        userFindUniqueMock.mockImplementation(async (args: any) => {
            if (args?.where?.id) {
                return mockUsersStore.find((u) => u.id === args.where.id) ?? null;
            }
            if (args?.where?.email) {
                return mockUsersStore.find((u) => u.email === args.where.email) ?? null;
            }
            return null;
        });

        userFindManyMock.mockImplementation(async () => {
            return mockUsersStore.filter((u) => u.platformRole !== null);
        });

        userCountMock.mockImplementation(async () => {
            return mockUsersStore.filter((u) => u.platformRole !== null).length;
        });
    });

    describe("1. Permission Gating & PLATFORM_OWNER Exclusivity", () => {
        it("allows PLATFORM_OWNER to create, update role, and deactivate platform operators", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            // 1. Create operator
            const res = await createPlatformUser(
                ownerContext,
                {
                    email: "new_support@aforden.com",
                    name: "Sam Support",
                    platformRole: PlatformRole.PLATFORM_SUPPORT,
                },
                "Hiring new support technician for EMEA tier-1 coverage."
            );
            expect(res.operator.platformRole).toBe(PlatformRole.PLATFORM_SUPPORT);
            expect(res.setupToken).toBeDefined();

            // 2. Change role
            const roleChanged = await changePlatformRole(
                ownerContext,
                res.operator.userId,
                PlatformRole.PLATFORM_OPERATIONS,
                "Promoting support engineer to operations infrastructure role."
            );
            expect(roleChanged.platformRole).toBe(PlatformRole.PLATFORM_OPERATIONS);

            // 3. Deactivate operator
            const deactivated = await deactivatePlatformUser(
                ownerContext,
                res.operator.userId,
                "Contract completion: deactivating temporary platform access."
            );
            expect(deactivated.status).toBe(PlatformAdminStatus.INACTIVE);

        });

        it("denies PLATFORM_ADMIN from mutating operations (invite, update_role, revoke)", async () => {
            const adminContext = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, "usr_admin_bob");

            // PLATFORM_ADMIN cannot invite
            await expect(
                createPlatformUser(
                    adminContext,
                    { email: "unauthorized@aforden.com", platformRole: PlatformRole.PLATFORM_SUPPORT },
                    "Attempting unauthorized invite from PLATFORM_ADMIN."
                )
            ).rejects.toThrow(PlatformAccessDeniedError);

            // PLATFORM_ADMIN cannot update role
            await expect(
                changePlatformRole(
                    adminContext,
                    "usr_admin_bob",
                    PlatformRole.PLATFORM_OWNER,
                    "Attempting unauthorized role change."
                )
            ).rejects.toThrow(PlatformAccessDeniedError);

            // PLATFORM_ADMIN cannot deactivate
            await expect(
                deactivatePlatformUser(
                    adminContext,
                    "usr_admin_bob",
                    "Attempting unauthorized deactivation."
                )
            ).rejects.toThrow(PlatformAccessDeniedError);

            expect(transactionMock).not.toHaveBeenCalled();
        });

        it("denies all non-owner roles (SUPPORT, OPERATIONS, SECURITY, BILLING) from mutating operations", async () => {
            const nonOwnerRoles = [
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_SECURITY,
                PlatformRole.PLATFORM_BILLING,
            ];

            for (const role of nonOwnerRoles) {
                const context = createMockPlatformContext(role);
                await expect(
                    createPlatformUser(
                        context,
                        { email: `test_${role}@aforden.com`, platformRole: PlatformRole.PLATFORM_SUPPORT },
                        "Attempting unauthorized invite."
                    )
                ).rejects.toThrow(PlatformAccessDeniedError);

                await expect(
                    changePlatformRole(
                        context,
                        "usr_admin_bob",
                        PlatformRole.PLATFORM_SUPPORT,
                        "Attempting unauthorized role update."
                    )
                ).rejects.toThrow(PlatformAccessDeniedError);

                await expect(
                    deactivatePlatformUser(
                        context,
                        "usr_admin_bob",
                        "Attempting unauthorized deactivation."
                    )
                ).rejects.toThrow(PlatformAccessDeniedError);
            }
        });

        it("allows PLATFORM_OWNER, PLATFORM_ADMIN, and PLATFORM_SECURITY to list operators via platform.operators.view", async () => {
            const authorizedViewRoles = [
                PlatformRole.PLATFORM_OWNER,
                PlatformRole.PLATFORM_ADMIN,
                PlatformRole.PLATFORM_SECURITY,
            ];

            for (const role of authorizedViewRoles) {
                const context = createMockPlatformContext(role);
                const list = await getPlatformUsers(context);
                expect(list.total).toBe(2);
                expect(list.operators).toHaveLength(2);
            }
        });

        it("denies roles lacking platform.operators.view from listing operators", async () => {
            const unauthorizedViewRoles = [
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_BILLING,
            ];

            for (const role of unauthorizedViewRoles) {
                const context = createMockPlatformContext(role);
                await expect(getPlatformUsers(context)).rejects.toThrow(PlatformAccessDeniedError);
            }
        });
    });

    describe("2. User Account Creation & Promotion Workflows", () => {
        it("promotes an existing base User into a platform operator", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            const res = await createPlatformUser(
                ownerContext,
                {
                    userId: "usr_regular_client",
                    platformRole: PlatformRole.PLATFORM_BILLING,
                    metadata: { department: "Finance" },
                },
                "Appointing internal billing specialist to manage enterprise invoices."
            );

            expect(res.operator.userId).toBe("usr_regular_client");
            expect(res.operator.platformRole).toBe(PlatformRole.PLATFORM_BILLING);
            expect(res.operator.status).toBe(PlatformAdminStatus.ACTIVE);
            expect(res.operator.metadata).toEqual({ department: "Finance" });
            // Existing promoted users already have credentials, so no setupToken is issued
            expect(res.setupToken).toBeNull();
            expect(res.setupUrl).toBeNull();

            // Audit record captures promotion diff
            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
            const call = auditLogCreateMock.mock.calls[0][0].data;
            expect(call.action).toBe(PLATFORM_AUDIT_EVENTS.OPERATOR_INVITED);
            expect(call.targetType).toBe("OPERATOR");
            expect(call.targetId).toBe("usr_regular_client");
            expect(call.previousState).toEqual({ platformRole: null, status: null });
            expect(call.newState).toEqual({
                platformRole: PlatformRole.PLATFORM_BILLING,
                status: PlatformAdminStatus.ACTIVE,
            });
        });

        it("onboards a new Operator from scratch when user does not exist", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            const res = await createPlatformUser(
                ownerContext,
                {
                    email: "brand_new_engineer@aforden.com",
                    name: "Alice Engineer",
                    platformRole: PlatformRole.PLATFORM_OPERATIONS,
                },
                "Onboarding infrastructure reliability engineer."
            );

            expect(res.operator.email).toBe("brand_new_engineer@aforden.com");
            expect(res.operator.name).toBe("Alice Engineer");
            expect(res.operator.platformRole).toBe(PlatformRole.PLATFORM_OPERATIONS);
            // Brand-new operator receives a one-time password setup token and URL
            expect(typeof res.setupToken).toBe("string");
            expect(res.setupToken!.length).toBeGreaterThan(10);
            expect(res.setupUrl).toContain("/reset-password?token=");

            // Audit record has Prisma.JsonNull previousState for newly created identity
            const call = auditLogCreateMock.mock.calls[0][0].data;
            expect(call.previousState).toBe(Prisma.JsonNull);
            expect(call.newState).toEqual({


                platformRole: PlatformRole.PLATFORM_OPERATIONS,
                status: PlatformAdminStatus.ACTIVE,
            });
        });

        it("rejects createPlatformUser if user is already an active platform operator", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            await expect(
                createPlatformUser(
                    ownerContext,
                    {
                        email: "admin_bob@aforden.com",
                        platformRole: PlatformRole.PLATFORM_SUPPORT,
                    },
                    "Attempting to re-invite an already active operator."
                )
            ).rejects.toThrow(PlatformOperatorConflictError);
        });

        it("rejects createPlatformUser when neither userId nor email is provided", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            await expect(
                createPlatformUser(
                    ownerContext,
                    { platformRole: PlatformRole.PLATFORM_SUPPORT } as any,
                    "Attempting invite with empty identifier."
                )
            ).rejects.toThrow(PlatformOperatorValidationError);
        });
    });

    describe("3. Tier-2 Reason Validation", () => {
        it("rejects reasons shorter than 10 characters before executing transaction", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            const invalidReasons = ["too short", "123456789", "         ", ""];
            for (const r of invalidReasons) {
                await expect(
                    changePlatformRole(
                        ownerContext,
                        "usr_admin_bob",
                        PlatformRole.PLATFORM_SECURITY,
                        r
                    )
                ).rejects.toThrow(PlatformActionValidationError);

                expect(transactionMock).not.toHaveBeenCalled();
            }
        });
    });

    describe("4. Last Owner Protection (Accidental Lockout Prevention)", () => {
        it("prevents demoting the sole remaining active PLATFORM_OWNER", async () => {
            // Currently mockUsersStore has only ONE PLATFORM_OWNER ("usr_owner_primary")
            const secondOwnerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_second_temp");

            await expect(
                changePlatformRole(
                    secondOwnerContext,
                    "usr_owner_primary",
                    PlatformRole.PLATFORM_ADMIN,
                    "Attempting to demote the only remaining owner."
                )
            ).rejects.toThrow(PlatformLastOwnerProtectionError);

            await expect(
                changePlatformRole(
                    secondOwnerContext,
                    "usr_owner_primary",
                    PlatformRole.PLATFORM_ADMIN,
                    "Attempting to demote the only remaining owner."
                )
            ).rejects.toThrow("Cannot demote the last remaining active PLATFORM_OWNER");

            // Role remains PLATFORM_OWNER
            const target = mockUsersStore.find((u) => u.id === "usr_owner_primary");
            expect(target.platformRole).toBe(PlatformRole.PLATFORM_OWNER);
        });

        it("prevents deactivating the sole remaining active PLATFORM_OWNER", async () => {
            const secondOwnerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_second_temp");

            await expect(
                deactivatePlatformUser(
                    secondOwnerContext,
                    "usr_owner_primary",
                    "Attempting to deactivate the sole active owner."
                )
            ).rejects.toThrow(PlatformLastOwnerProtectionError);

            // Status remains ACTIVE
            const target = mockUsersStore.find((u) => u.id === "usr_owner_primary");
            expect(target.platformAdminProfile.status).toBe(PlatformAdminStatus.ACTIVE);
        });

        it("allows demoting or deactivating an owner when multiple active owners exist", async () => {
            // Seed a second active owner
            mockUsersStore.push({
                id: "usr_owner_secondary",
                email: "owner2@aforden.com",
                name: "Secondary Owner",
                avatarUrl: null,
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_OWNER,
                platformAdminProfile: {
                    id: "prof_owner_2",
                    userId: "usr_owner_secondary",
                    status: PlatformAdminStatus.ACTIVE,
                },
            });

            const primaryOwnerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            // Demoting secondary owner should now SUCCEED because 2 active owners exist
            const result = await changePlatformRole(
                primaryOwnerContext,
                "usr_owner_secondary",
                PlatformRole.PLATFORM_ADMIN,
                "Transitioning executive owner to standard admin role."
            );

            expect(result.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
        });
    });

    describe("5. Self-Modification Guard", () => {
        it("rejects an operator attempting to change their own role", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            await expect(
                changePlatformRole(
                    ownerContext,
                    "usr_owner_primary",
                    PlatformRole.PLATFORM_ADMIN,
                    "Self-demotion attempt."
                )
            ).rejects.toThrow(PlatformSelfModificationError);

            await expect(
                changePlatformRole(
                    ownerContext,
                    "usr_owner_primary",
                    PlatformRole.PLATFORM_ADMIN,
                    "Self-demotion attempt."
                )
            ).rejects.toThrow("Operators cannot alter their own platform role");
        });

        it("rejects an operator attempting to deactivate their own account", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            await expect(
                deactivatePlatformUser(
                    ownerContext,
                    "usr_owner_primary",
                    "Self-deactivation attempt."
                )
            ).rejects.toThrow(PlatformSelfModificationError);

            await expect(
                deactivatePlatformUser(
                    ownerContext,
                    "usr_owner_primary",
                    "Self-deactivation attempt."
                )
            ).rejects.toThrow("Operators cannot deactivate their own platform account");
        });
    });

    describe("6. Compliance Audit Trail & Transaction Atomicity", () => {
        it("creates OPERATOR_ROLE_UPDATED audit record with previousState and newState diff", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");
            const reason = "Department reorg: assigning security compliance responsibilities.";

            const updated = await changePlatformRole(
                ownerContext,
                "usr_admin_bob",
                PlatformRole.PLATFORM_SECURITY,
                reason,
                {
                    requestId: "req_sec_reorg_01",
                    ipAddress: "10.0.0.99",
                }
            );

            expect(updated.platformRole).toBe(PlatformRole.PLATFORM_SECURITY);

            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
            const call = auditLogCreateMock.mock.calls[0][0].data;
            expect(call.action).toBe(PLATFORM_AUDIT_EVENTS.OPERATOR_ROLE_UPDATED);
            expect(call.targetType).toBe("OPERATOR");
            expect(call.targetId).toBe("usr_admin_bob");
            expect(call.previousState).toEqual({ platformRole: PlatformRole.PLATFORM_ADMIN });
            expect(call.newState).toEqual({ platformRole: PlatformRole.PLATFORM_SECURITY });
            expect(call.actorUserId).toBe(ownerContext.userId);
            expect(call.reason).toBe(reason);
            expect(call.requestId).toBe("req_sec_reorg_01");
            expect(call.ipAddress).toBe("10.0.0.99");
        });

        it("creates OPERATOR_REVOKED audit record with status diff", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");
            const reason = "Staff departure: revoking administrative platform privileges.";

            const deactivated = await deactivatePlatformUser(
                ownerContext,
                "usr_admin_bob",
                reason
            );

            expect(deactivated.status).toBe(PlatformAdminStatus.INACTIVE);

            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
            const call = auditLogCreateMock.mock.calls[0][0].data;
            expect(call.action).toBe(PLATFORM_AUDIT_EVENTS.OPERATOR_REVOKED);
            expect(call.previousState).toEqual({ status: PlatformAdminStatus.ACTIVE });
            expect(call.newState).toEqual({ status: PlatformAdminStatus.INACTIVE });
        });

        it("rolls back role mutation when audit log writing fails inside transaction", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            transactionMock.mockImplementationOnce(async (callback: (tx: any) => Promise<any>) => {
                const backup = JSON.parse(JSON.stringify(mockUsersStore));
                const txClient = {
                    user: {
                        findUnique: vi.fn().mockResolvedValue(mockUsersStore.find((u) => u.id === "usr_admin_bob")),
                        update: vi.fn().mockImplementation(async (args: any) => {
                            const target = mockUsersStore.find((u) => u.id === args.where.id);
                            target.platformRole = args.data.platformRole;
                            return target;
                        }),
                    },
                    platformAdminProfile: {
                        count: vi.fn().mockResolvedValue(1),
                    },
                    platformAuditLog: {
                        create: vi.fn().mockRejectedValue(new Error("Audit log ledger disk full")),
                    },
                };

                try {
                    return await callback(txClient);
                } catch (err) {
                    mockUsersStore = backup;
                    throw err;
                }
            });

            await expect(
                changePlatformRole(
                    ownerContext,
                    "usr_admin_bob",
                    PlatformRole.PLATFORM_OPERATIONS,
                    "Role change with simulated audit failure."
                )
            ).rejects.toThrow("Audit log ledger disk full");

            // Role remains original PLATFORM_ADMIN due to rollback
            const bob = mockUsersStore.find((u) => u.id === "usr_admin_bob");
            expect(bob.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
        });
    });

    describe("7. Credential Leakage Prevention (DTO Hygiene)", () => {
        it("strictly omits passwordHash and internal auth secrets from returned DTO", async () => {
            const ownerContext = createMockPlatformContext(PlatformRole.PLATFORM_OWNER, "usr_owner_primary");

            const detail = await getPlatformUser(ownerContext, "usr_admin_bob");
            expect(detail).not.toBeNull();
            expect((detail as any).passwordHash).toBeUndefined();
            expect(detail?.userId).toBe("usr_admin_bob");
            expect(detail?.email).toBe("admin_bob@aforden.com");
            expect(detail?.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);

            const list = await getPlatformUsers(ownerContext);
            for (const op of list.operators) {
                expect((op as any).passwordHash).toBeUndefined();
            }
        });
    });
});
