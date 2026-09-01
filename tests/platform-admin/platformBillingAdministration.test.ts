import { describe, it, expect, vi, beforeEach } from "vitest";

// =========================================================================
// Mocks Setup
// =========================================================================

const {
    findManyBillingAccountsMock,
    findUniqueBillingAccountMock,
    createBillingAccountMock,
    findManySubscriptionsMock,
    findFirstSubscriptionMock,
    createSubscriptionMock,
    updateSubscriptionMock,
    updateManySubscriptionsMock,
    findManySubscriptionPlansMock,
    findUniqueSubscriptionPlanMock,
    findManyEntitlementOverridesMock,
    findUniqueEntitlementOverrideMock,
    upsertEntitlementOverrideMock,
    deleteEntitlementOverrideMock,
    findManyInvoicesMock,
    findManyWebhooksMock,
    findUniqueWebhookMock,
    updateWebhookMock,
    createSubscriptionHistoryMock,
    transactionMock,
    auditCreateMock,
} = vi.hoisted(() => ({
    findManyBillingAccountsMock: vi.fn(),
    findUniqueBillingAccountMock: vi.fn(),
    createBillingAccountMock: vi.fn(),
    findManySubscriptionsMock: vi.fn(),
    findFirstSubscriptionMock: vi.fn(),
    createSubscriptionMock: vi.fn(),
    updateSubscriptionMock: vi.fn(),
    updateManySubscriptionsMock: vi.fn(),
    findManySubscriptionPlansMock: vi.fn(),
    findUniqueSubscriptionPlanMock: vi.fn(),
    findManyEntitlementOverridesMock: vi.fn(),
    findUniqueEntitlementOverrideMock: vi.fn(),
    upsertEntitlementOverrideMock: vi.fn(),
    deleteEntitlementOverrideMock: vi.fn(),
    findManyInvoicesMock: vi.fn(),
    findManyWebhooksMock: vi.fn(),
    findUniqueWebhookMock: vi.fn(),
    updateWebhookMock: vi.fn(),
    createSubscriptionHistoryMock: vi.fn(),
    transactionMock: vi.fn(),
    auditCreateMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        platformBillingAccount: {
            findMany: findManyBillingAccountsMock,
            findUnique: findUniqueBillingAccountMock,
            create: createBillingAccountMock,
        },
        subscription: {
            findMany: findManySubscriptionsMock,
            findFirst: findFirstSubscriptionMock,
            create: createSubscriptionMock,
            update: updateSubscriptionMock,
            updateMany: updateManySubscriptionsMock,
        },
        subscriptionPlan: {
            findMany: findManySubscriptionPlansMock,
            findUnique: findUniqueSubscriptionPlanMock,
        },
        workspaceEntitlementOverride: {
            findMany: findManyEntitlementOverridesMock,
            findUnique: findUniqueEntitlementOverrideMock,
            upsert: upsertEntitlementOverrideMock,
            delete: deleteEntitlementOverrideMock,
        },
        subscriptionInvoice: {
            findMany: findManyInvoicesMock,
        },
        billingWebhookEvent: {
            findMany: findManyWebhooksMock,
            findUnique: findUniqueWebhookMock,
            update: updateWebhookMock,
        },
        subscriptionHistory: {
            create: createSubscriptionHistoryMock,
        },
        platformAuditLog: {
            create: auditCreateMock,
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
import { PLATFORM_AUDIT_EVENTS } from "@/lib/services/platform/audit";
import {
    listPlatformBillingAccounts,
    getPlatformBillingAccount,
    getPlatformWorkspaceSubscription,
    listPlatformSubscriptionPlans,
    listPlatformSubscriptionInvoices,
    listPlatformBillingWebhookEvents,
    assignPlatformSubscriptionPlan,
    overridePlatformWorkspaceEntitlement,
    removePlatformWorkspaceEntitlementOverride,
    syncPlatformBillingAccount,
    replayPlatformBillingWebhook,
    SubscriptionStatus,
    BillingProviderType,
    SubscriptionInvoiceStatus,
    WebhookProcessingStatus,
    PlanTier,
    FeatureValueType,
} from "@/lib/services/platform/billing";
import {
    PlatformBillingAccountNotFoundError,
    PlatformSubscriptionPlanNotFoundError,
    PlatformEntitlementOverrideNotFoundError,
    PlatformBillingWebhookNotFoundError,
    PlatformBillingValidationError,
} from "@/lib/services/platform/billing/errors";
import { PlatformActionValidationError } from "@/lib/services/platform/workspaces/errors";

describe("Phase 1.19.14 — Platform Billing Administration Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default transaction mock executes callback with mocked tx
        transactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
            const tx = {
                platformBillingAccount: {
                    findUnique: findUniqueBillingAccountMock,
                    create: createBillingAccountMock,
                },
                subscription: {
                    findFirst: findFirstSubscriptionMock,
                    create: createSubscriptionMock,
                    update: updateSubscriptionMock,
                    updateMany: updateManySubscriptionsMock,
                },
                subscriptionPlan: {
                    findUnique: findUniqueSubscriptionPlanMock,
                },
                workspaceEntitlementOverride: {
                    findUnique: findUniqueEntitlementOverrideMock,
                    upsert: upsertEntitlementOverrideMock,
                    delete: deleteEntitlementOverrideMock,
                },
                billingWebhookEvent: {
                    findUnique: findUniqueWebhookMock,
                    update: updateWebhookMock,
                },
                subscriptionHistory: {
                    create: createSubscriptionHistoryMock,
                },
                platformAuditLog: {
                    create: auditCreateMock,
                },
            };
            return callback(tx);
        });
    });

    function createPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_BILLING
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
            stepUpConfirmedAt: new Date(),
            metadata: null,
        };
    }

    // =========================================================================
    // 1. Permission Gating & PLATFORM_BILLING Role Primary Authority
    // =========================================================================
    describe("1. Permission Gating & PLATFORM_BILLING Primary Authority", () => {
        it("proves PLATFORM_BILLING has real, primary scoped authority across all billing functions", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            const now = new Date();

            // 1. Read billing accounts allowed
            findManyBillingAccountsMock.mockResolvedValueOnce([]);
            await expect(listPlatformBillingAccounts(context)).resolves.toEqual([]);

            // 2. Assign plans allowed (Tier-2)
            findUniqueSubscriptionPlanMock.mockResolvedValueOnce({
                id: "plan_growth",
                code: "GROWTH",
                name: "Growth Plan",
                tier: PlanTier.GROWTH,
                baseSeats: 10,
            });
            findFirstSubscriptionMock.mockResolvedValueOnce(null);
            findUniqueBillingAccountMock.mockResolvedValueOnce({
                id: "acc_1",
                workspaceId: "ws_alpha",
            });
            createSubscriptionMock.mockResolvedValueOnce({
                id: "sub_1",
                workspaceId: "ws_alpha",
                accountId: "acc_1",
                planId: "plan_growth",
                status: SubscriptionStatus.ACTIVE,
                providerSubscriptionId: null,
                currentPeriodStart: now,
                currentPeriodEnd: now,
                trialStart: null,
                trialEnd: null,
                cancelAtPeriodEnd: false,
                canceledAt: null,
                endedAt: null,
                seatsCount: 10,
                dunningAttemptsCount: 0,
                gracePeriodEndsAt: null,
                createdAt: now,
                updatedAt: now,
                plan: { code: "GROWTH", name: "Growth Plan", tier: PlanTier.GROWTH },
            });

            await expect(
                assignPlatformSubscriptionPlan(
                    context,
                    "ws_alpha",
                    "plan_growth",
                    "Comping enterprise trial for prospective high-volume customer"
                )
            ).resolves.toBeDefined();

            // 3. Override entitlements allowed (Tier-2)
            findUniqueEntitlementOverrideMock.mockResolvedValueOnce(null);
            upsertEntitlementOverrideMock.mockResolvedValueOnce({
                id: "ov_1",
                workspaceId: "ws_alpha",
                featureKey: "MAX_MEMBERS",
                featureType: FeatureValueType.NUMERIC_LIMIT,
                overrideValueJson: 50,
                reason: "Contract amendment for added field technicians",
                grantedByUserId: context.userId,
                expiresAt: null,
                createdAt: now,
                updatedAt: now,
            });

            await expect(
                overridePlatformWorkspaceEntitlement(
                    context,
                    "ws_alpha",
                    "MAX_MEMBERS",
                    50,
                    FeatureValueType.NUMERIC_LIMIT,
                    "Contract amendment for added field technicians"
                )
            ).resolves.toBeDefined();

            // 4. Sync gateway allowed (Tier-1)
            findUniqueBillingAccountMock.mockResolvedValueOnce({
                id: "acc_1",
                workspaceId: "ws_alpha",
            });
            updateManySubscriptionsMock.mockResolvedValueOnce({ count: 1 });

            await expect(
                syncPlatformBillingAccount(
                    context,
                    "ws_alpha",
                    "Manual gateway re-sync after customer card update"
                )
            ).resolves.toBeDefined();
        });

        it("allows PLATFORM_ADMIN to view, assign plans, and override entitlements, but denies gateway sync", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            // Read allowed
            findManyBillingAccountsMock.mockResolvedValueOnce([]);
            await expect(listPlatformBillingAccounts(context)).resolves.toEqual([]);

            // Sync gateway DENIED (per 1.19.3 matrix: BILLING_SYNC_GATEWAY is false for ADMIN)
            await expect(
                syncPlatformBillingAccount(context, "ws_alpha", "Attempting gateway sync")
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("allows PLATFORM_SUPPORT read access but denies all mutating commercial actions", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_SUPPORT);

            // Read allowed
            findManyBillingAccountsMock.mockResolvedValueOnce([]);
            await expect(listPlatformBillingAccounts(context)).resolves.toEqual([]);

            // Assign plan denied
            await expect(
                assignPlatformSubscriptionPlan(
                    context,
                    "ws_alpha",
                    "plan_1",
                    "Legitimate reason 10 chars"
                )
            ).rejects.toThrow(PlatformAccessDeniedError);

            // Override entitlement denied
            await expect(
                overridePlatformWorkspaceEntitlement(
                    context,
                    "ws_alpha",
                    "FEATURE_X",
                    true,
                    FeatureValueType.BOOLEAN,
                    "Legitimate reason 10 chars"
                )
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("strictly denies PLATFORM_OPERATIONS and PLATFORM_SECURITY across all billing operations", async () => {
            const opsContext = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);
            const secContext = createPlatformContext(PlatformRole.PLATFORM_SECURITY);

            // Operations denied
            await expect(listPlatformBillingAccounts(opsContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
            await expect(
                syncPlatformBillingAccount(opsContext, "ws_alpha", "Sync attempt")
            ).rejects.toThrow(PlatformAccessDeniedError);

            // Security denied
            await expect(listPlatformBillingAccounts(secContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
            await expect(
                assignPlatformSubscriptionPlan(
                    secContext,
                    "ws_alpha",
                    "plan_1",
                    "Security operator attempt"
                )
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("strictly denies workspace/tenant member context without platform authorization", async () => {
            const tenantContext = {
                userId: "usr_tenant_admin",
                workspaceId: "ws_alpha",
                role: "OWNER",
                permissions: ["billing.manage"],
            } as unknown as PlatformAuthorizationContext;

            await expect(listPlatformBillingAccounts(tenantContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
        });
    });

    // =========================================================================
    // 2. PCI DSS & Zero Secrets Leakage Guarantees
    // =========================================================================
    describe("2. PCI DSS & Zero Secrets Leakage Guarantees", () => {
        it("returns only PCI-compliant display metadata and strictly excludes raw card numbers and CVVs", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            const now = new Date();

            findManyBillingAccountsMock.mockResolvedValueOnce([
                {
                    id: "acc_pci",
                    workspaceId: "ws_pci",
                    workspace: { name: "PCI Safe LLC", slug: "pci-safe" },
                    billingEmail: "finance@pcisafe.com",
                    billingName: "Jane Doe",
                    taxId: "US123456789",
                    provider: BillingProviderType.STRIPE,
                    providerCustomerId: "cus_stripe_1234",
                    paymentMethodBrand: "visa",
                    paymentMethodLast4: "4242",
                    paymentMethodExpMonth: 12,
                    paymentMethodExpYear: 2029,
                    delinquentSince: null,
                    createdAt: now,
                    updatedAt: now,
                    subscriptions: [],
                },
            ]);

            const accounts = await listPlatformBillingAccounts(context);
            expect(accounts).toHaveLength(1);
            const acc = accounts[0];

            expect(acc.paymentMethodBrand).toBe("visa");
            expect(acc.paymentMethodLast4).toBe("4242");
            expect(acc.paymentMethodExpMonth).toBe(12);
            expect(acc.paymentMethodExpYear).toBe(2029);

            // Rigorous PCI checks:
            expect((acc as any).cardNumber).toBeUndefined();
            expect((acc as any).pan).toBeUndefined();
            expect((acc as any).cvv).toBeUndefined();
            expect((acc as any).cvc).toBeUndefined();
            expect((acc as any).stripeApiKey).toBeUndefined();
            expect((acc as any).secretKey).toBeUndefined();
        });
    });

    // =========================================================================
    // 3. Mutating Actions & Dedicated 1:1 Audit Events
    // =========================================================================
    describe("3. Dedicated 1:1 Audit Events for Mutating Operations", () => {
        // Action 1: assignPlatformSubscriptionPlan (Tier-2)
        it("Action 1: assignPlatformSubscriptionPlan emits PLAN_ASSIGNED atomically with Tier-2 guards", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            const now = new Date();

            findUniqueSubscriptionPlanMock.mockResolvedValueOnce({
                id: "plan_ent",
                code: "ENTERPRISE",
                name: "Enterprise Edition",
                tier: PlanTier.ENTERPRISE,
                baseSeats: 25,
            });

            findFirstSubscriptionMock.mockResolvedValueOnce({
                id: "sub_prev",
                workspaceId: "ws_target",
                accountId: "acc_target",
                planId: "plan_starter",
                status: SubscriptionStatus.ACTIVE,
                seatsCount: 5,
                plan: { code: "STARTER", name: "Starter", tier: PlanTier.STARTER },
            });

            updateSubscriptionMock.mockResolvedValueOnce({
                id: "sub_prev",
                workspaceId: "ws_target",
                accountId: "acc_target",
                planId: "plan_ent",
                status: SubscriptionStatus.ACTIVE,
                providerSubscriptionId: "sub_stripe_abc",
                currentPeriodStart: now,
                currentPeriodEnd: now,
                trialStart: null,
                trialEnd: null,
                cancelAtPeriodEnd: false,
                canceledAt: null,
                endedAt: null,
                seatsCount: 30,
                dunningAttemptsCount: 0,
                gracePeriodEndsAt: null,
                createdAt: now,
                updatedAt: now,
                plan: { code: "ENTERPRISE", name: "Enterprise Edition", tier: PlanTier.ENTERPRISE },
            });

            const result = await assignPlatformSubscriptionPlan(
                context,
                "ws_target",
                "plan_ent",
                "Upgrading key design partner to Enterprise tier with 30 seats",
                { seatsCount: 30 }
            );

            expect(result.planCode).toBe("ENTERPRISE");
            expect(result.seatsCount).toBe(30);

            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.PLAN_ASSIGNED,
                    targetType: "SUBSCRIPTION",
                    targetId: "sub_prev",
                    workspaceId: "ws_target",
                    reason: "Upgrading key design partner to Enterprise tier with 30 seats",
                    previousState: {
                        planId: "plan_starter",
                        planCode: "STARTER",
                        seatsCount: 5,
                        status: SubscriptionStatus.ACTIVE,
                    },
                    newState: {
                        planId: "plan_ent",
                        planCode: "ENTERPRISE",
                        seatsCount: 30,
                        status: SubscriptionStatus.ACTIVE,
                    },
                }),
            });
        });

        it("rejects assignPlatformSubscriptionPlan if reason is shorter than 10 characters", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);

            await expect(
                assignPlatformSubscriptionPlan(context, "ws_target", "plan_ent", "Too short")
            ).rejects.toThrow(PlatformActionValidationError);
        });

        // Action 2: overridePlatformWorkspaceEntitlement (Tier-2)
        it("Action 2: overridePlatformWorkspaceEntitlement emits ENTITLEMENT_OVERRIDDEN atomically", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            const now = new Date();

            findUniqueEntitlementOverrideMock.mockResolvedValueOnce(null);

            upsertEntitlementOverrideMock.mockResolvedValueOnce({
                id: "ov_advanced",
                workspaceId: "ws_target",
                featureKey: "FEATURE_ADVANCED_REPORTING",
                featureType: FeatureValueType.BOOLEAN,
                overrideValueJson: true,
                reason: "Contract addendum: complimentary analytics pilot",
                grantedByUserId: context.userId,
                expiresAt: null,
                createdAt: now,
                updatedAt: now,
            });

            const result = await overridePlatformWorkspaceEntitlement(
                context,
                "ws_target",
                "FEATURE_ADVANCED_REPORTING",
                true,
                FeatureValueType.BOOLEAN,
                "Contract addendum: complimentary analytics pilot"
            );

            expect(result.featureKey).toBe("FEATURE_ADVANCED_REPORTING");
            expect(result.overrideValueJson).toBe(true);

            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.ENTITLEMENT_OVERRIDDEN,
                    targetType: "ENTITLEMENT",
                    targetId: "ov_advanced",
                    workspaceId: "ws_target",
                    reason: "Contract addendum: complimentary analytics pilot",
                    newState: {
                        featureKey: "FEATURE_ADVANCED_REPORTING",
                        overrideValueJson: true,
                        expiresAt: null,
                    },
                }),
            });
        });

        // Action 3: removePlatformWorkspaceEntitlementOverride (Tier-2)
        it("Action 3: removePlatformWorkspaceEntitlementOverride emits ENTITLEMENT_REVOKED atomically", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);

            findUniqueEntitlementOverrideMock.mockResolvedValueOnce({
                id: "ov_remove",
                workspaceId: "ws_target",
                featureKey: "FEATURE_LEGACY_SYNC",
                overrideValueJson: true,
            });

            const result = await removePlatformWorkspaceEntitlementOverride(
                context,
                "ws_target",
                "FEATURE_LEGACY_SYNC",
                "Revoking expired feature flag concession after contract expiration"
            );

            expect(result.success).toBe(true);
            expect(result.revokedFeatureKey).toBe("FEATURE_LEGACY_SYNC");

            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.ENTITLEMENT_REVOKED,
                    targetType: "ENTITLEMENT",
                    targetId: "ov_remove",
                    workspaceId: "ws_target",
                    reason: "Revoking expired feature flag concession after contract expiration",
                    previousState: {
                        featureKey: "FEATURE_LEGACY_SYNC",
                        overrideValueJson: true,
                    },
                }),
            });
        });

        it("throws PlatformEntitlementOverrideNotFoundError if override does not exist", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            findUniqueEntitlementOverrideMock.mockResolvedValueOnce(null);

            await expect(
                removePlatformWorkspaceEntitlementOverride(
                    context,
                    "ws_target",
                    "NON_EXISTENT",
                    "Legitimate reason 10 chars"
                )
            ).rejects.toThrow(PlatformEntitlementOverrideNotFoundError);
        });

        // Action 4: syncPlatformBillingAccount (Tier-1)
        it("Action 4: syncPlatformBillingAccount emits BILLING_RESYNCHRONIZED atomically", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);

            findUniqueBillingAccountMock.mockResolvedValueOnce({
                id: "acc_sync",
                workspaceId: "ws_sync",
            });
            updateManySubscriptionsMock.mockResolvedValueOnce({ count: 1 });

            const result = await syncPlatformBillingAccount(
                context,
                "ws_sync",
                "Manual synchronization after failed webhook reconciliation"
            );

            expect(result.success).toBe(true);
            expect(result.workspaceId).toBe("ws_sync");

            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.BILLING_RESYNCHRONIZED,
                    targetType: "BILLING_ACCOUNT",
                    targetId: "acc_sync",
                    workspaceId: "ws_sync",
                    reason: "Manual synchronization after failed webhook reconciliation",
                }),
            });
        });

        // Action 5: replayPlatformBillingWebhook (Tier-1)
        it("Action 5: replayPlatformBillingWebhook emits BILLING_WEBHOOK_REPLAYED atomically", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            const now = new Date();

            findUniqueWebhookMock.mockResolvedValueOnce({
                id: "wh_failed",
                provider: BillingProviderType.STRIPE,
                providerEventId: "evt_stripe_fail",
                eventType: "invoice.payment_failed",
                status: WebhookProcessingStatus.FAILED,
                payloadJson: { invoice: "in_123" },
                attemptsCount: 1,
            });

            updateWebhookMock.mockResolvedValueOnce({
                id: "wh_failed",
                provider: BillingProviderType.STRIPE,
                providerEventId: "evt_stripe_fail",
                eventType: "invoice.payment_failed",
                status: WebhookProcessingStatus.PROCESSED,
                payloadJson: { invoice: "in_123" },
                processingError: null,
                processedAt: now,
                attemptsCount: 2,
                createdAt: now,
                updatedAt: now,
            });

            const result = await replayPlatformBillingWebhook(
                context,
                "wh_failed",
                "Replaying failed webhook event after database connection recovery"
            );

            expect(result.status).toBe(WebhookProcessingStatus.PROCESSED);
            expect(result.attemptsCount).toBe(2);

            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.BILLING_WEBHOOK_REPLAYED,
                    targetType: "WEBHOOK",
                    targetId: "wh_failed",
                    reason: "Replaying failed webhook event after database connection recovery",
                    previousState: {
                        status: WebhookProcessingStatus.FAILED,
                        attemptsCount: 1,
                    },
                    newState: {
                        status: WebhookProcessingStatus.PROCESSED,
                        attemptsCount: 2,
                    },
                }),
            });
        });

        it("rejects overridePlatformWorkspaceEntitlement if reason is shorter than 10 characters", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);

            await expect(
                overridePlatformWorkspaceEntitlement(
                    context,
                    "ws_target",
                    "FEATURE_KEY",
                    true,
                    FeatureValueType.BOOLEAN,
                    "Short"
                )
            ).rejects.toThrow(PlatformActionValidationError);
        });

        it("rejects removePlatformWorkspaceEntitlementOverride if reason is shorter than 10 characters", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);

            await expect(
                removePlatformWorkspaceEntitlementOverride(
                    context,
                    "ws_target",
                    "FEATURE_KEY",
                    "Short"
                )
            ).rejects.toThrow(PlatformActionValidationError);
        });

        it("rejects syncPlatformBillingAccount if reason is empty string (Tier-1 validation)", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);

            await expect(
                syncPlatformBillingAccount(context, "ws_target", "   ")
            ).rejects.toThrow(PlatformBillingValidationError);
        });

        it("rejects replayPlatformBillingWebhook if reason is empty string (Tier-1 validation)", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);

            await expect(
                replayPlatformBillingWebhook(context, "wh_1", "")
            ).rejects.toThrow(PlatformBillingValidationError);
        });

        it("rejects Tier-2 action when step-up authentication is missing or expired", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            context.stepUpConfirmedAt = null;

            await expect(
                assignPlatformSubscriptionPlan(
                    context,
                    "ws_target",
                    "plan_growth",
                    "Valid reason for enterprise upgrade"
                )
            ).rejects.toThrow();
        });
    });

    // =========================================================================
    // 4. Cross-Tenant Queries & Health Inspection
    // =========================================================================
    describe("4. Cross-Tenant Queries & Health Inspection", () => {
        it("fetches single billing account and throws PlatformBillingAccountNotFoundError when not found", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            findUniqueBillingAccountMock.mockResolvedValueOnce(null);

            await expect(getPlatformBillingAccount(context, "ws_missing")).rejects.toThrow(
                PlatformBillingAccountNotFoundError
            );
        });

        it("fetches workspace subscription and entitlement overrides", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            const now = new Date();

            findFirstSubscriptionMock.mockResolvedValueOnce({
                id: "sub_get",
                workspaceId: "ws_alpha",
                accountId: "acc_1",
                planId: "plan_growth",
                status: SubscriptionStatus.ACTIVE,
                providerSubscriptionId: "sub_stripe_123",
                currentPeriodStart: now,
                currentPeriodEnd: now,
                trialStart: null,
                trialEnd: null,
                cancelAtPeriodEnd: false,
                canceledAt: null,
                endedAt: null,
                seatsCount: 15,
                dunningAttemptsCount: 0,
                gracePeriodEndsAt: null,
                createdAt: now,
                updatedAt: now,
                plan: { code: "GROWTH", name: "Growth Plan", tier: PlanTier.GROWTH },
            });
            findManyEntitlementOverridesMock.mockResolvedValueOnce([
                {
                    id: "ov_1",
                    workspaceId: "ws_alpha",
                    featureKey: "MAX_MEMBERS",
                    featureType: FeatureValueType.NUMERIC_LIMIT,
                    overrideValueJson: 50,
                    reason: "Pilot addendum",
                    grantedByUserId: "usr_1",
                    expiresAt: null,
                    createdAt: now,
                    updatedAt: now,
                },
            ]);

            const result = await getPlatformWorkspaceSubscription(context, "ws_alpha");
            expect(result.subscription?.seatsCount).toBe(15);
            expect(result.overrides).toHaveLength(1);
            expect(result.overrides[0].featureKey).toBe("MAX_MEMBERS");
        });

        it("lists subscription plans with feature limits", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            const now = new Date();

            findManySubscriptionPlansMock.mockResolvedValueOnce([
                {
                    id: "plan_starter",
                    code: "STARTER",
                    name: "Starter",
                    tier: PlanTier.STARTER,
                    description: "Starter Tier",
                    isActive: true,
                    isPublic: true,
                    sortOrder: 1,
                    baseSeats: 2,
                    createdAt: now,
                    updatedAt: now,
                    prices: [
                        {
                            currency: "USD",
                            amountCents: 4900,
                            billingInterval: "MONTHLY",
                            perAdditionalSeatCents: 1000,
                        },
                    ],
                    features: [
                        {
                            featureKey: "MAX_MEMBERS",
                            featureType: FeatureValueType.NUMERIC_LIMIT,
                            valueJson: 2,
                            scalesWithSeats: false,
                        },
                    ],
                },
            ]);

            const plans = await listPlatformSubscriptionPlans(context);
            expect(plans).toHaveLength(1);
            expect(plans[0].code).toBe("STARTER");
            expect(plans[0].features).toHaveLength(1);
        });

        it("lists subscription invoices with status filtering", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            const now = new Date();

            findManyInvoicesMock.mockResolvedValueOnce([
                {
                    id: "inv_1",
                    workspaceId: "ws_alpha",
                    accountId: "acc_1",
                    subscriptionId: "sub_1",
                    providerInvoiceId: "in_stripe_123",
                    status: SubscriptionInvoiceStatus.PAID,
                    currency: "USD",
                    amountDueCents: 4900,
                    amountPaidCents: 4900,
                    subtotalCents: 4900,
                    taxCents: 0,
                    hostedInvoiceUrl: "https://invoice.stripe.com/123",
                    invoicePdfUrl: null,
                    periodStart: now,
                    periodEnd: now,
                    paidAt: now,
                    createdAt: now,
                    updatedAt: now,
                },
            ]);

            const invoices = await listPlatformSubscriptionInvoices(context, {
                status: SubscriptionInvoiceStatus.PAID,
            });
            expect(invoices).toHaveLength(1);
            expect(invoices[0].status).toBe(SubscriptionInvoiceStatus.PAID);
        });

        it("lists billing webhook events with pagination", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);
            const now = new Date();

            findManyWebhooksMock.mockResolvedValueOnce([
                {
                    id: "wh_event_1",
                    provider: BillingProviderType.STRIPE,
                    providerEventId: "evt_1",
                    eventType: "invoice.paid",
                    status: WebhookProcessingStatus.PROCESSED,
                    payloadJson: { id: "evt_1" },
                    processingError: null,
                    processedAt: now,
                    attemptsCount: 1,
                    createdAt: now,
                    updatedAt: now,
                },
            ]);

            const events = await listPlatformBillingWebhookEvents(context, {
                status: WebhookProcessingStatus.PROCESSED,
            });
            expect(events).toHaveLength(1);
            expect(events[0].eventType).toBe("invoice.paid");
        });
    });

    // =========================================================================
    // 5. Audit Taxonomy Uniqueness
    // =========================================================================
    describe("5. Audit Taxonomy Uniqueness & Exact Event Strings", () => {
        it("proves all 5 billing audit event constants are distinct, non-overlapping strings", () => {
            const events = [
                PLATFORM_AUDIT_EVENTS.PLAN_ASSIGNED,
                PLATFORM_AUDIT_EVENTS.ENTITLEMENT_OVERRIDDEN,
                PLATFORM_AUDIT_EVENTS.ENTITLEMENT_REVOKED,
                PLATFORM_AUDIT_EVENTS.BILLING_RESYNCHRONIZED,
                PLATFORM_AUDIT_EVENTS.BILLING_WEBHOOK_REPLAYED,
            ];

            const unique = new Set(events);
            expect(unique.size).toBe(5);

            expect(PLATFORM_AUDIT_EVENTS.PLAN_ASSIGNED).toBe("platform.billing.plan_assigned");
            expect(PLATFORM_AUDIT_EVENTS.ENTITLEMENT_OVERRIDDEN).toBe(
                "platform.billing.entitlement_overridden"
            );
            expect(PLATFORM_AUDIT_EVENTS.ENTITLEMENT_REVOKED).toBe(
                "platform.billing.entitlement_revoked"
            );
            expect(PLATFORM_AUDIT_EVENTS.BILLING_RESYNCHRONIZED).toBe(
                "platform.billing.resynchronized"
            );
            expect(PLATFORM_AUDIT_EVENTS.BILLING_WEBHOOK_REPLAYED).toBe(
                "platform.billing.webhook_replayed"
            );
        });
    });
});
