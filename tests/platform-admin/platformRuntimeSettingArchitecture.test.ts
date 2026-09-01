import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock functions
const {
    settingFindUniqueMock,
    settingFindManyMock,
    settingCountMock,
    settingUpsertMock,
    settingDeleteMock,
    auditLogCreateMock,
    transactionMock,
} = vi.hoisted(() => ({
    settingFindUniqueMock: vi.fn(),
    settingFindManyMock: vi.fn(),
    settingCountMock: vi.fn(),
    settingUpsertMock: vi.fn(),
    settingDeleteMock: vi.fn(),
    auditLogCreateMock: vi.fn(),
    transactionMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        platformRuntimeSetting: {
            findUnique: settingFindUniqueMock,
            findMany: settingFindManyMock,
            count: settingCountMock,
            upsert: settingUpsertMock,
            delete: settingDeleteMock,
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
    PLATFORM_AUDIT_EVENTS,
} from "@/lib/services/platform/audit";
import {
    getSetting,
    listSettings,
    upsertSetting,
    deleteSetting,
    getSettingValue,
    invalidateRuntimeSettingCache,
    validateSettingValue,
    PlatformRuntimeSettingNotFoundError,
    PlatformRuntimeSettingValidationError,
    PlatformRuntimeSettingProtectedError,
} from "@/lib/services/platform/settings";

describe("Phase 1.19.11 — Platform Configuration Management Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invalidateRuntimeSettingCache();

        transactionMock.mockImplementation(async (cb: any) => {
            const txClient = {
                platformRuntimeSetting: {
                    findUnique: settingFindUniqueMock,
                    upsert: settingUpsertMock,
                    delete: settingDeleteMock,
                },
                platformAuditLog: {
                    create: auditLogCreateMock,
                },
            };
            return cb(txClient);
        });
    });

    function createMockPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_ADMIN,
        stepUpConfirmedAt: Date | null = new Date()
    ): PlatformAuthorizationContext {
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
            stepUpConfirmedAt,
            metadata: null,
        };
    }

    describe("1. Permission Gating (CONFIG_VIEW & CONFIG_UPDATE_SETTINGS)", () => {
        it("allows roles with CONFIG_VIEW to read settings", async () => {
            const grantedRoles = [
                PlatformRole.PLATFORM_OWNER,
                PlatformRole.PLATFORM_ADMIN,
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_SECURITY,
            ];

            settingFindUniqueMock.mockResolvedValue({
                id: "set_1",
                key: "rate_limit.default_rpm",
                value: 60,
                valueType: "NUMBER",
                description: "Default RPM limit",
                isProtected: false,
                metadata: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            for (const role of grantedRoles) {
                const ctx = createMockPlatformContext(role);
                const res = await getSetting(ctx, "rate_limit.default_rpm");
                expect(res).not.toBeNull();
                expect(res?.key).toBe("rate_limit.default_rpm");
            }
        });

        it("denies roles lacking CONFIG_VIEW from reading settings", async () => {
            const deniedRoles = [PlatformRole.PLATFORM_BILLING];

            for (const role of deniedRoles) {
                const ctx = createMockPlatformContext(role);
                await expect(getSetting(ctx, "rate_limit.default_rpm")).rejects.toThrow(
                    PlatformAccessDeniedError
                );
                await expect(listSettings(ctx)).rejects.toThrow(
                    PlatformAccessDeniedError
                );
            }
        });

        it("allows roles with CONFIG_UPDATE_SETTINGS to mutate settings", async () => {
            const grantedRoles = [
                PlatformRole.PLATFORM_OWNER,
                PlatformRole.PLATFORM_ADMIN,
                PlatformRole.PLATFORM_OPERATIONS,
            ];

            settingFindUniqueMock.mockResolvedValue(null);
            settingUpsertMock.mockResolvedValue({
                id: "set_2",
                key: "jobs.outbox_batch_size",
                value: 500,
                valueType: "NUMBER",
                description: "Outbox batch size",
                isProtected: false,
                metadata: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            for (const role of grantedRoles) {
                const ctx = createMockPlatformContext(role);
                const res = await upsertSetting(ctx, {
                    key: "jobs.outbox_batch_size",
                    value: 500,
                    valueType: "NUMBER",
                });
                expect(res.key).toBe("jobs.outbox_batch_size");
            }
        });

        it("denies roles lacking CONFIG_UPDATE_SETTINGS from mutating settings", async () => {
            const deniedRoles = [
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_SECURITY,
                PlatformRole.PLATFORM_BILLING,
            ];

            for (const role of deniedRoles) {
                const ctx = createMockPlatformContext(role);
                await expect(
                    upsertSetting(ctx, {
                        key: "jobs.outbox_batch_size",
                        value: 500,
                        valueType: "NUMBER",
                    })
                ).rejects.toThrow(PlatformAccessDeniedError);

                await expect(
                    deleteSetting(ctx, "jobs.outbox_batch_size")
                ).rejects.toThrow(PlatformAccessDeniedError);
            }
        });
    });

    describe("2. Value Typing & Input Validation", () => {
        it("validates STRING, NUMBER, BOOLEAN, and JSON value types correctly", () => {
            expect(() => validateSettingValue("test.str", "hello", "STRING")).not.toThrow();
            expect(() => validateSettingValue("test.num", 42, "NUMBER")).not.toThrow();
            expect(() => validateSettingValue("test.bool", true, "BOOLEAN")).not.toThrow();
            expect(() => validateSettingValue("test.json", { a: 1 }, "JSON")).not.toThrow();
        });

        it("rejects mismatched value types", () => {
            expect(() => validateSettingValue("test.str", 123, "STRING")).toThrow(
                PlatformRuntimeSettingValidationError
            );
            expect(() => validateSettingValue("test.num", "not_a_number", "NUMBER")).toThrow(
                PlatformRuntimeSettingValidationError
            );
            expect(() => validateSettingValue("test.bool", "true", "BOOLEAN")).toThrow(
                PlatformRuntimeSettingValidationError
            );
            expect(() => validateSettingValue("test.json", "invalid_json_str", "JSON")).toThrow(
                PlatformRuntimeSettingValidationError
            );
        });

        it("enforces boundary constraints on known setting keys", () => {
            expect(() => validateSettingValue("rate_limit.default_rpm", 0, "NUMBER")).toThrow(
                PlatformRuntimeSettingValidationError
            );
            expect(() => validateSettingValue("rate_limit.default_rpm", 200_000, "NUMBER")).toThrow(
                PlatformRuntimeSettingValidationError
            );
            expect(() => validateSettingValue("rate_limit.burst_multiplier", 100, "NUMBER")).toThrow(
                PlatformRuntimeSettingValidationError
            );
            expect(() => validateSettingValue("jobs.outbox_batch_size", 5000, "NUMBER")).toThrow(
                PlatformRuntimeSettingValidationError
            );
            expect(() => validateSettingValue("system.maintenance_mode", "on", "BOOLEAN" as any)).toThrow(
                PlatformRuntimeSettingValidationError
            );
        });
    });

    describe("3. Secrets Exclusion Guard (Invariant #7)", () => {
        it("rejects storing secret/credential setting keys", () => {
            const forbiddenKeys = [
                "api.stripe_secret_key",
                "auth.jwt_secret",
                "db.password",
                "aws.private_key",
                "auth.bearer_token",
                "services.credential_store",
                "database.connection_string",
                "partner.api_key",
            ];

            for (const key of forbiddenKeys) {
                expect(() => validateSettingValue(key, "super_secret_value", "STRING")).toThrow(
                    PlatformRuntimeSettingValidationError
                );
            }
        });
    });

    describe("4. Protection Tiers & Step-Up Re-Authentication", () => {
        it("allows Tier-1 standard setting updates without step-up auth", async () => {
            const ctx = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, null);
            settingFindUniqueMock.mockResolvedValue(null);
            settingUpsertMock.mockResolvedValue({
                id: "set_std",
                key: "ui.theme_default",
                value: "dark",
                valueType: "STRING",
                description: "Default theme",
                isProtected: false,
                metadata: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await upsertSetting(ctx, {
                key: "ui.theme_default",
                value: "dark",
                valueType: "STRING",
            });

            expect(result.key).toBe("ui.theme_default");
        });

        it("requires recent Step-Up Auth and min 10-char reason for Tier-2 protected settings", async () => {
            // Setting system.maintenance_mode is intrinsically protected
            const unverifiedCtx = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, null);

            await expect(
                upsertSetting(
                    unverifiedCtx,
                    { key: "system.maintenance_mode", value: true, valueType: "BOOLEAN" },
                    "System upgrade scheduled for 2:00 AM"
                )
            ).rejects.toThrow(PlatformRuntimeSettingProtectedError);

            // Valid step-up auth within 5 mins
            const recentStepUpCtx = createMockPlatformContext(
                PlatformRole.PLATFORM_ADMIN,
                new Date()
            );

            settingFindUniqueMock.mockResolvedValue(null);
            settingUpsertMock.mockResolvedValue({
                id: "set_maint",
                key: "system.maintenance_mode",
                value: true,
                valueType: "BOOLEAN",
                description: null,
                isProtected: true,
                metadata: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await upsertSetting(
                recentStepUpCtx,
                { key: "system.maintenance_mode", value: true, valueType: "BOOLEAN" },
                "Emergency database migration and schema patch"
            );

            expect(result.isProtected).toBe(true);
        });

        it("rejects protected setting updates if justification reason is missing or < 10 chars", async () => {
            const recentStepUpCtx = createMockPlatformContext(
                PlatformRole.PLATFORM_ADMIN,
                new Date()
            );

            await expect(
                upsertSetting(
                    recentStepUpCtx,
                    { key: "system.maintenance_mode", value: true, valueType: "BOOLEAN" },
                    "short"
                )
            ).rejects.toThrow(PlatformRuntimeSettingValidationError);
        });

        it("rejects protected setting updates if step-up timestamp is older than 5 minutes", async () => {
            const staleStepUpDate = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago
            const staleCtx = createMockPlatformContext(
                PlatformRole.PLATFORM_ADMIN,
                staleStepUpDate
            );

            await expect(
                upsertSetting(
                    staleCtx,
                    { key: "system.maintenance_mode", value: true, valueType: "BOOLEAN" },
                    "Detailed justification message exceeding ten chars"
                )
            ).rejects.toThrow(PlatformRuntimeSettingProtectedError);
        });
    });

    describe("5. Audit Integration & Transactional Atomicity", () => {
        it("emits RUNTIME_SETTING_UPDATED audit event synchronously inside transaction", async () => {
            const ctx = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);

            settingFindUniqueMock.mockResolvedValue({
                id: "set_10",
                key: "rate_limit.default_rpm",
                value: 60,
                valueType: "NUMBER",
                description: "Old limit",
                isProtected: false,
                metadata: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            settingUpsertMock.mockResolvedValue({
                id: "set_10",
                key: "rate_limit.default_rpm",
                value: 120,
                valueType: "NUMBER",
                description: "Updated limit",
                isProtected: false,
                metadata: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await upsertSetting(
                ctx,
                {
                    key: "rate_limit.default_rpm",
                    value: 120,
                    valueType: "NUMBER",
                    description: "Updated limit",
                },
                "Increasing capacity for enterprise launch"
            );

            expect(transactionMock).toHaveBeenCalledTimes(1);
            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
            expect(auditLogCreateMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        action: PLATFORM_AUDIT_EVENTS.RUNTIME_SETTING_UPDATED,
                        targetType: "CONFIG",
                        targetId: "set_10",
                        previousState: expect.objectContaining({
                            key: "rate_limit.default_rpm",
                            value: 60,
                        }),
                        newState: expect.objectContaining({
                            key: "rate_limit.default_rpm",
                            value: 120,
                        }),
                    }),
                })
            );
        });

        it("rolls back setting update when audit log write fails inside transaction", async () => {
            const ctx = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);

            settingFindUniqueMock.mockResolvedValue(null);
            settingUpsertMock.mockResolvedValue({
                id: "set_fail",
                key: "test.rollback",
                value: "fail",
                valueType: "STRING",
            });

            auditLogCreateMock.mockRejectedValueOnce(
                new Error("Audit database write constraint failure")
            );

            await expect(
                upsertSetting(ctx, {
                    key: "test.rollback",
                    value: "fail",
                    valueType: "STRING",
                })
            ).rejects.toThrow("Audit database write constraint failure");
        });
    });

    describe("6. Performant Reader & Safe Fallback API", () => {
        it("caches setting values in memory for hot path evaluations", async () => {
            settingFindUniqueMock.mockResolvedValue({
                id: "set_cache",
                key: "rate_limit.default_rpm",
                value: 100,
                valueType: "NUMBER",
            });

            const val1 = await getSettingValue<number>("rate_limit.default_rpm", 60);
            expect(val1).toBe(100);
            expect(settingFindUniqueMock).toHaveBeenCalledTimes(1);

            // Second read within TTL hits cache (zero DB calls)
            const val2 = await getSettingValue<number>("rate_limit.default_rpm", 60);
            expect(val2).toBe(100);
            expect(settingFindUniqueMock).toHaveBeenCalledTimes(1);

            // Invalidate cache forces new DB fetch
            invalidateRuntimeSettingCache("rate_limit.default_rpm");
            await getSettingValue<number>("rate_limit.default_rpm", 60);
            expect(settingFindUniqueMock).toHaveBeenCalledTimes(2);
        });

        it("returns safe fallback value when key does not exist or DB throws error", async () => {
            settingFindUniqueMock.mockResolvedValue(null);
            const valMissing = await getSettingValue<number>("non_existent_key", 999);
            expect(valMissing).toBe(999);

            settingFindUniqueMock.mockRejectedValueOnce(new Error("Database connection lost"));
            const valError = await getSettingValue<string>("any_key", "default_string");
            expect(valError).toBe("default_string");
        });
    });
});
