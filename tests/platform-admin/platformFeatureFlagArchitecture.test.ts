import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock functions
const {
    flagFindUniqueMock,
    flagFindManyMock,
    flagCountMock,
    flagCreateMock,
    flagUpdateMock,
    flagDeleteMock,
    auditLogCreateMock,
    transactionMock,
} = vi.hoisted(() => ({
    flagFindUniqueMock: vi.fn(),
    flagFindManyMock: vi.fn(),
    flagCountMock: vi.fn(),
    flagCreateMock: vi.fn(),
    flagUpdateMock: vi.fn(),
    flagDeleteMock: vi.fn(),
    auditLogCreateMock: vi.fn(),
    transactionMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        platformFeatureFlag: {
            findUnique: flagFindUniqueMock,
            findMany: flagFindManyMock,
            count: flagCountMock,
            create: flagCreateMock,
            update: flagUpdateMock,
            delete: flagDeleteMock,
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
    createFeatureFlag,
    updateFeatureFlag,
    toggleFeatureFlag,
    deleteFeatureFlag,
    getFeatureFlag,
    listFeatureFlags,
    isFeatureEnabled,
    invalidateFeatureFlagCache,
    getStableHashBucket,
    PlatformFeatureFlagNotFoundError,
    PlatformFeatureFlagConflictError,
    PlatformFeatureFlagValidationError,
} from "@/lib/services/platform/flags";
import { PLATFORM_AUDIT_EVENTS } from "@/lib/services/platform/audit";
import { Prisma } from "@/generated/prisma/client";

describe("Phase 1.19.10 — Feature Flag Architecture Suite", () => {
    let mockFlagsStore: any[];

    function createMockPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_ADMIN,
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

    function seedInitialFlags() {
        return [
            {
                id: "flag_1",
                key: "billing_v2",
                name: "Billing Engine V2",
                description: "New subscription state machine",
                enabled: true,
                defaultValue: false,
                rolloutPercentage: 25,
                allowedWorkspaceIds: ["ws_vip_alpha", "ws_vip_beta"],
                metadata: { category: "billing" },
                createdAt: new Date("2026-01-01T00:00:00Z"),
                updatedAt: new Date("2026-08-01T00:00:00Z"),
            },
            {
                id: "flag_2",
                key: "ai_dispatch_assistant",
                name: "AI Dispatch Assistant",
                description: "Automated route optimization",
                enabled: false,
                defaultValue: false,
                rolloutPercentage: 100,
                allowedWorkspaceIds: [],
                metadata: null,
                createdAt: new Date("2026-02-01T00:00:00Z"),
                updatedAt: new Date("2026-08-10T00:00:00Z"),
            },
        ];
    }

    beforeEach(() => {
        vi.clearAllMocks();
        invalidateFeatureFlagCache();
        mockFlagsStore = seedInitialFlags();

        transactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
            const backup = JSON.parse(JSON.stringify(mockFlagsStore));
            const txClient = {
                platformFeatureFlag: {
                    findUnique: vi.fn().mockImplementation(async (args: any) => {
                        return mockFlagsStore.find((f) => f.key === args.where.key) ?? null;
                    }),
                    create: vi.fn().mockImplementation(async (args: any) => {
                        flagCreateMock(args);
                        const newFlag = {
                            id: `flag_${Date.now()}`,
                            ...args.data,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        };
                        mockFlagsStore.push(newFlag);
                        return newFlag;
                    }),
                    update: vi.fn().mockImplementation(async (args: any) => {
                        flagUpdateMock(args);
                        const target = mockFlagsStore.find((f) => f.key === args.where.key);
                        if (target) {
                            Object.assign(target, args.data);
                        }
                        return target;
                    }),
                    delete: vi.fn().mockImplementation(async (args: any) => {
                        flagDeleteMock(args);
                        const index = mockFlagsStore.findIndex((f) => f.key === args.where.key);
                        if (index !== -1) {
                            mockFlagsStore.splice(index, 1);
                        }
                    }),
                },
                platformAuditLog: {
                    create: vi.fn().mockImplementation(async (args: any) => {
                        auditLogCreateMock(args);
                        return { id: `audit_${Date.now()}`, ...args.data };
                    }),
                },
            };

            try {
                return await callback(txClient);
            } catch (err) {
                mockFlagsStore = backup;
                throw err;
            }
        });

        flagFindUniqueMock.mockImplementation(async (args: any) => {
            return mockFlagsStore.find((f) => f.key === args.where.key) ?? null;
        });

        flagFindManyMock.mockImplementation(async () => {
            return mockFlagsStore;
        });

        flagCountMock.mockImplementation(async () => {
            return mockFlagsStore.length;
        });

        flagDeleteMock.mockImplementation(async (args: any) => {
            const index = mockFlagsStore.findIndex((f) => f.key === args.where.key);
            if (index !== -1) {
                mockFlagsStore.splice(index, 1);
            }
        });
    });

    describe("1. CRUD Permission Gating Alignment", () => {
        it("allows PLATFORM_OWNER and PLATFORM_ADMIN to manage feature flags (create, update, toggle, delete)", async () => {
            const adminContext = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, "usr_admin_1");

            // 1. Create flag
            const created = await createFeatureFlag(
                adminContext,
                {
                    key: "dark_mode_v2",
                    name: "Dark Mode V2",
                    enabled: false,
                    rolloutPercentage: 50,
                },
                "Launching dark mode v2 beta."
            );
            expect(created.key).toBe("dark_mode_v2");

            // 2. Toggle flag
            const toggled = await toggleFeatureFlag(adminContext, "dark_mode_v2", true, "Enabling dark mode for beta");
            expect(toggled.enabled).toBe(true);

            // 3. Update flag rules
            const updated = await updateFeatureFlag(
                adminContext,
                "dark_mode_v2",
                { rolloutPercentage: 75 },
                "Expanding rollout percentage to 75%"
            );
            expect(updated.rolloutPercentage).toBe(75);

            // 4. Delete flag
            await deleteFeatureFlag(adminContext, "dark_mode_v2");
            expect(mockFlagsStore.find((f) => f.key === "dark_mode_v2")).toBeUndefined();
        });

        it("denies PLATFORM_SUPPORT, PLATFORM_OPERATIONS, PLATFORM_SECURITY, and PLATFORM_BILLING from mutating flags", async () => {
            const mutatingRoles = [
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_SECURITY,
                PlatformRole.PLATFORM_BILLING,
            ];

            for (const role of mutatingRoles) {
                const context = createMockPlatformContext(role);
                await expect(
                    createFeatureFlag(context, { key: `flag_${role.toLowerCase()}`, name: "Test Flag" })
                ).rejects.toThrow(PlatformAccessDeniedError);

                await expect(
                    toggleFeatureFlag(context, "billing_v2", false)
                ).rejects.toThrow(PlatformAccessDeniedError);

                await expect(
                    updateFeatureFlag(context, "billing_v2", { rolloutPercentage: 50 })
                ).rejects.toThrow(PlatformAccessDeniedError);

                await expect(
                    deleteFeatureFlag(context, "billing_v2")
                ).rejects.toThrow(PlatformAccessDeniedError);
            }
        });

        it("allows PLATFORM_OWNER, ADMIN, SUPPORT, OPERATIONS, and SECURITY to read flags via platform.config.view", async () => {
            const viewRoles = [
                PlatformRole.PLATFORM_OWNER,
                PlatformRole.PLATFORM_ADMIN,
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_SECURITY,
            ];

            for (const role of viewRoles) {
                const context = createMockPlatformContext(role);
                const flag = await getFeatureFlag(context, "billing_v2");
                expect(flag).not.toBeNull();
                expect(flag?.key).toBe("billing_v2");

                const list = await listFeatureFlags(context);
                expect(list.total).toBe(2);
            }
        });

        it("denies roles lacking platform.config.view (PLATFORM_BILLING) from reading flags", async () => {
            const billingContext = createMockPlatformContext(PlatformRole.PLATFORM_BILLING);
            await expect(getFeatureFlag(billingContext, "billing_v2")).rejects.toThrow(PlatformAccessDeniedError);
            await expect(listFeatureFlags(billingContext)).rejects.toThrow(PlatformAccessDeniedError);
        });
    });

    describe("2. Deterministic Flag Evaluation & Percentage Rollout", () => {
        it("returns 100% identical evaluation result when evaluating the same flag + target 100 times", async () => {
            const targetWorkspace = { workspaceId: "ws_acme_corp_99" };

            const firstResult = await isFeatureEnabled("billing_v2", targetWorkspace);

            for (let i = 0; i < 100; i++) {
                const evalResult = await isFeatureEnabled("billing_v2", targetWorkspace);
                expect(evalResult).toBe(firstResult);
            }
        });

        it("distributes percentage rollout deterministically across 1,000 workspace IDs in expected proportion (~25%)", async () => {
            let enabledCount = 0;
            const sampleSize = 1000;

            for (let i = 0; i < sampleSize; i++) {
                const wsId = `ws_sample_target_${i}`;
                const isEnabled = await isFeatureEnabled("billing_v2", { workspaceId: wsId });
                if (isEnabled) {
                    enabledCount++;
                }

                // Verify hash bucket formula directly matches
                const bucket = getStableHashBucket("billing_v2", wsId);
                expect(isEnabled).toBe(bucket < 25);
            }

            // Statistical threshold: 25% of 1000 = 250 (allow ± 50 variance for uniform hash distribution)
            expect(enabledCount).toBeGreaterThan(200);
            expect(enabledCount).toBeLessThan(300);
        });

        it("evaluates to true for explicit workspace allowlist overrides regardless of percentage rollout", async () => {
            // "ws_vip_alpha" is in allowedWorkspaceIds for "billing_v2"
            const result = await isFeatureEnabled("billing_v2", { workspaceId: "ws_vip_alpha" });
            expect(result).toBe(true);
        });

        it("evaluates to defaultValue (false) when master enabled toggle is false", async () => {
            // "ai_dispatch_assistant" has enabled: false
            const result = await isFeatureEnabled("ai_dispatch_assistant", { workspaceId: "ws_any" });
            expect(result).toBe(false);
        });
    });

    describe("3. Safe Fallback Handling", () => {
        it("fails safely to false/fallback default when DB throws an exception", async () => {
            flagFindUniqueMock.mockRejectedValueOnce(new Error("Database connection lost"));

            const res = await isFeatureEnabled("billing_v2", { workspaceId: "ws_alpha" });
            expect(res).toBe(false);

            flagFindUniqueMock.mockRejectedValueOnce(new Error("Database connection lost"));
            const fallbackRes = await isFeatureEnabled("billing_v2", { workspaceId: "ws_alpha" }, { fallback: true });
            expect(fallbackRes).toBe(true);
        });

        it("fails safely to false when evaluating an unknown flag key", async () => {
            const res = await isFeatureEnabled("unknown_nonexistent_flag");
            expect(res).toBe(false);
        });
    });

    describe("4. Three Distinct Audit Events Integration", () => {
        it("triggers FEATURE_FLAG_CREATED audit event on flag creation", async () => {
            const adminContext = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, "usr_admin_1");

            await createFeatureFlag(
                adminContext,
                {
                    key: "new_calendar_ui",
                    name: "New Calendar UI",
                    enabled: true,
                    rolloutPercentage: 100,
                },
                "Creating calendar feature flag."
            );

            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
            const call = auditLogCreateMock.mock.calls[0][0].data;
            expect(call.action).toBe(PLATFORM_AUDIT_EVENTS.FEATURE_FLAG_CREATED);
            expect(call.targetType).toBe("FEATURE_FLAG");
            expect(call.previousState).toBe(Prisma.JsonNull);
            expect(call.newState.key).toBe("new_calendar_ui");
        });

        it("triggers FEATURE_FLAG_UPDATED audit event on flag rules update", async () => {
            const adminContext = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, "usr_admin_1");

            await updateFeatureFlag(
                adminContext,
                "billing_v2",
                { rolloutPercentage: 50 },
                "Updating rollout to 50%"
            );

            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
            const call = auditLogCreateMock.mock.calls[0][0].data;
            expect(call.action).toBe(PLATFORM_AUDIT_EVENTS.FEATURE_FLAG_UPDATED);
            expect(call.previousState.rolloutPercentage).toBe(25);
            expect(call.newState.rolloutPercentage).toBe(50);
        });

        it("triggers FEATURE_FLAG_TOGGLED audit event on master toggle change", async () => {
            const adminContext = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, "usr_admin_1");

            await toggleFeatureFlag(
                adminContext,
                "ai_dispatch_assistant",
                true,
                "Enabling AI dispatch assistant globally."
            );

            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
            const call = auditLogCreateMock.mock.calls[0][0].data;
            expect(call.action).toBe(PLATFORM_AUDIT_EVENTS.FEATURE_FLAG_TOGGLED);
            expect(call.previousState).toEqual({ enabled: false });
            expect(call.newState).toEqual({ enabled: true });
        });

        it("triggers FEATURE_FLAG_DELETED audit event on flag deletion", async () => {
            const adminContext = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, "usr_admin_1");

            await deleteFeatureFlag(
                adminContext,
                "billing_v2",
                "Retiring legacy billing flag."
            );

            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
            const call = auditLogCreateMock.mock.calls[0][0].data;
            expect(call.action).toBe(PLATFORM_AUDIT_EVENTS.FEATURE_FLAG_DELETED);
            expect(call.targetType).toBe("FEATURE_FLAG");
            expect(call.previousState.key).toBe("billing_v2");
            expect(call.newState).toBe(Prisma.JsonNull);
        });
    });


    describe("5. Tier-1 Non-Dangerous Exemption Verification", () => {
        it("succeeds toggling a feature flag without requiring min 10-char reason string or step-up auth", async () => {
            const adminContext = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, "usr_admin_1");
            adminContext.stepUpConfirmedAt = null; // No step up

            // Empty/short reason is valid for Tier-1 flag toggles
            const toggled = await toggleFeatureFlag(adminContext, "billing_v2", false);
            expect(toggled.enabled).toBe(false);
        });
    });
});
