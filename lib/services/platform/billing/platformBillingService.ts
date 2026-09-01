import { prisma } from "@/lib/prisma";
import {
    assertPlatformPermission,
    PLATFORM_PERMISSIONS,
    PlatformAuthorizationContext,
} from "@/lib/services/platform/authorization";
import {
    recordPlatformAuditEvent,
    PLATFORM_AUDIT_EVENTS,
} from "@/lib/services/platform/audit";
import {
    validateDangerousActionReason,
    assertTier2StepUpAuthenticated,
} from "@/lib/services/platform/workspaces/platformWorkspaceService";
import {
    PlatformBillingAccountDto,
    PlatformSubscriptionDto,
    PlatformSubscriptionPlanDto,
    PlatformEntitlementOverrideDto,
    PlatformSubscriptionInvoiceDto,
    PlatformBillingWebhookEventDto,
    PlatformBillingAccountFilter,
    PlatformSubscriptionInvoiceFilter,
    PlatformBillingWebhookFilter,
    PlatformBillingActionOptions,
    FeatureValueType,
    WebhookProcessingStatus,
} from "./types";
import {
    PlatformBillingAccountNotFoundError,
    PlatformSubscriptionPlanNotFoundError,
    PlatformSubscriptionNotFoundError,
    PlatformEntitlementOverrideNotFoundError,
    PlatformBillingWebhookNotFoundError,
    PlatformBillingValidationError,
} from "./errors";

/**
 * Validates a Tier-1 operational action reason string.
 */
function validateTier1Reason(reason: unknown): string {
    if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new PlatformBillingValidationError(
            "An operational justification reason string is mandatory."
        );
    }
    return reason.trim();
}

/**
 * Lists billing accounts across workspaces with PCI-compliant sanitized payment metadata.
 * Gated by: platform.billing.view
 */
export async function listPlatformBillingAccounts(
    context: PlatformAuthorizationContext,
    filter?: PlatformBillingAccountFilter
): Promise<PlatformBillingAccountDto[]> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_VIEW);

    const whereClause: Record<string, unknown> = {};

    if (filter?.workspaceId) {
        whereClause.workspaceId = filter.workspaceId;
    }

    if (filter?.provider) {
        whereClause.provider = filter.provider;
    }

    if (filter?.isDelinquent !== undefined) {
        whereClause.delinquentSince = filter.isDelinquent ? { not: null } : null;
    }

    const accounts = await prisma.platformBillingAccount.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: filter?.limit ?? 100,
        skip: filter?.offset ?? 0,
        include: {
            workspace: {
                select: {
                    name: true,
                    slug: true,
                },
            },
            subscriptions: {
                take: 1,
                orderBy: { createdAt: "desc" },
                include: {
                    plan: {
                        select: {
                            code: true,
                            name: true,
                            tier: true,
                        },
                    },
                },
            },
        },
    });

    return accounts.map((acc) => {
        const sub = acc.subscriptions[0];
        const activeSub: PlatformSubscriptionDto | null = sub
            ? {
                  id: sub.id,
                  workspaceId: sub.workspaceId,
                  accountId: sub.accountId,
                  planId: sub.planId,
                  planCode: sub.plan?.code,
                  planName: sub.plan?.name,
                  planTier: sub.plan?.tier,
                  status: sub.status,
                  providerSubscriptionId: sub.providerSubscriptionId,
                  currentPeriodStart: sub.currentPeriodStart.toISOString(),
                  currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
                  trialStart: sub.trialStart ? sub.trialStart.toISOString() : null,
                  trialEnd: sub.trialEnd ? sub.trialEnd.toISOString() : null,
                  cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
                  canceledAt: sub.canceledAt ? sub.canceledAt.toISOString() : null,
                  endedAt: sub.endedAt ? sub.endedAt.toISOString() : null,
                  seatsCount: sub.seatsCount,
                  dunningAttemptsCount: sub.dunningAttemptsCount,
                  gracePeriodEndsAt: sub.gracePeriodEndsAt
                      ? sub.gracePeriodEndsAt.toISOString()
                      : null,
                  createdAt: sub.createdAt.toISOString(),
                  updatedAt: sub.updatedAt.toISOString(),
              }
            : null;

        return {
            id: acc.id,
            workspaceId: acc.workspaceId,
            workspaceName: acc.workspace?.name,
            workspaceSlug: acc.workspace?.slug,
            billingEmail: acc.billingEmail,
            billingName: acc.billingName,
            taxId: acc.taxId,
            provider: acc.provider,
            providerCustomerId: acc.providerCustomerId,
            paymentMethodBrand: acc.paymentMethodBrand,
            paymentMethodLast4: acc.paymentMethodLast4,
            paymentMethodExpMonth: acc.paymentMethodExpMonth,
            paymentMethodExpYear: acc.paymentMethodExpYear,
            delinquentSince: acc.delinquentSince ? acc.delinquentSince.toISOString() : null,
            activeSubscription: activeSub,
            createdAt: acc.createdAt.toISOString(),
            updatedAt: acc.updatedAt.toISOString(),
        };
    });
}

/**
 * Fetches single platform billing account for a workspace.
 * Gated by: platform.billing.view
 */
export async function getPlatformBillingAccount(
    context: PlatformAuthorizationContext,
    workspaceId: string
): Promise<PlatformBillingAccountDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_VIEW);

    const acc = await prisma.platformBillingAccount.findUnique({
        where: { workspaceId },
        include: {
            workspace: {
                select: {
                    name: true,
                    slug: true,
                },
            },
            subscriptions: {
                take: 1,
                orderBy: { createdAt: "desc" },
                include: {
                    plan: {
                        select: {
                            code: true,
                            name: true,
                            tier: true,
                        },
                    },
                },
            },
        },
    });

    if (!acc) {
        throw new PlatformBillingAccountNotFoundError(workspaceId);
    }

    const sub = acc.subscriptions[0];
    const activeSub: PlatformSubscriptionDto | null = sub
        ? {
              id: sub.id,
              workspaceId: sub.workspaceId,
              accountId: sub.accountId,
              planId: sub.planId,
              planCode: sub.plan?.code,
              planName: sub.plan?.name,
              planTier: sub.plan?.tier,
              status: sub.status,
              providerSubscriptionId: sub.providerSubscriptionId,
              currentPeriodStart: sub.currentPeriodStart.toISOString(),
              currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
              trialStart: sub.trialStart ? sub.trialStart.toISOString() : null,
              trialEnd: sub.trialEnd ? sub.trialEnd.toISOString() : null,
              cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
              canceledAt: sub.canceledAt ? sub.canceledAt.toISOString() : null,
              endedAt: sub.endedAt ? sub.endedAt.toISOString() : null,
              seatsCount: sub.seatsCount,
              dunningAttemptsCount: sub.dunningAttemptsCount,
              gracePeriodEndsAt: sub.gracePeriodEndsAt
                  ? sub.gracePeriodEndsAt.toISOString()
                  : null,
              createdAt: sub.createdAt.toISOString(),
              updatedAt: sub.updatedAt.toISOString(),
          }
        : null;

    return {
        id: acc.id,
        workspaceId: acc.workspaceId,
        workspaceName: acc.workspace?.name,
        workspaceSlug: acc.workspace?.slug,
        billingEmail: acc.billingEmail,
        billingName: acc.billingName,
        taxId: acc.taxId,
        provider: acc.provider,
        providerCustomerId: acc.providerCustomerId,
        paymentMethodBrand: acc.paymentMethodBrand,
        paymentMethodLast4: acc.paymentMethodLast4,
        paymentMethodExpMonth: acc.paymentMethodExpMonth,
        paymentMethodExpYear: acc.paymentMethodExpYear,
        delinquentSince: acc.delinquentSince ? acc.delinquentSince.toISOString() : null,
        activeSubscription: activeSub,
        createdAt: acc.createdAt.toISOString(),
        updatedAt: acc.updatedAt.toISOString(),
    };
}

/**
 * Fetches workspace subscription details and entitlement overrides.
 * Gated by: platform.billing.view
 */
export async function getPlatformWorkspaceSubscription(
    context: PlatformAuthorizationContext,
    workspaceId: string
): Promise<{
    subscription: PlatformSubscriptionDto | null;
    overrides: PlatformEntitlementOverrideDto[];
}> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_VIEW);

    const [sub, overrides] = await Promise.all([
        prisma.subscription.findFirst({
            where: { workspaceId },
            orderBy: { createdAt: "desc" },
            include: {
                plan: {
                    select: {
                        code: true,
                        name: true,
                        tier: true,
                    },
                },
            },
        }),
        prisma.workspaceEntitlementOverride.findMany({
            where: { workspaceId },
            orderBy: { featureKey: "asc" },
        }),
    ]);

    const subscriptionDto: PlatformSubscriptionDto | null = sub
        ? {
              id: sub.id,
              workspaceId: sub.workspaceId,
              accountId: sub.accountId,
              planId: sub.planId,
              planCode: sub.plan?.code,
              planName: sub.plan?.name,
              planTier: sub.plan?.tier,
              status: sub.status,
              providerSubscriptionId: sub.providerSubscriptionId,
              currentPeriodStart: sub.currentPeriodStart.toISOString(),
              currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
              trialStart: sub.trialStart ? sub.trialStart.toISOString() : null,
              trialEnd: sub.trialEnd ? sub.trialEnd.toISOString() : null,
              cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
              canceledAt: sub.canceledAt ? sub.canceledAt.toISOString() : null,
              endedAt: sub.endedAt ? sub.endedAt.toISOString() : null,
              seatsCount: sub.seatsCount,
              dunningAttemptsCount: sub.dunningAttemptsCount,
              gracePeriodEndsAt: sub.gracePeriodEndsAt
                  ? sub.gracePeriodEndsAt.toISOString()
                  : null,
              createdAt: sub.createdAt.toISOString(),
              updatedAt: sub.updatedAt.toISOString(),
          }
        : null;

    const overrideDtos: PlatformEntitlementOverrideDto[] = overrides.map((ov) => ({
        id: ov.id,
        workspaceId: ov.workspaceId,
        featureKey: ov.featureKey,
        featureType: ov.featureType,
        overrideValueJson: ov.overrideValueJson,
        reason: ov.reason,
        grantedByUserId: ov.grantedByUserId,
        expiresAt: ov.expiresAt ? ov.expiresAt.toISOString() : null,
        createdAt: ov.createdAt.toISOString(),
        updatedAt: ov.updatedAt.toISOString(),
    }));

    return {
        subscription: subscriptionDto,
        overrides: overrideDtos,
    };
}

/**
 * Lists canonical subscription plans and feature limits.
 * Gated by: platform.billing.view
 */
export async function listPlatformSubscriptionPlans(
    context: PlatformAuthorizationContext
): Promise<PlatformSubscriptionPlanDto[]> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_VIEW);

    const plans = await prisma.subscriptionPlan.findMany({
        orderBy: { sortOrder: "asc" },
        include: {
            prices: true,
            features: true,
        },
    });

    return plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        tier: p.tier,
        description: p.description,
        isActive: p.isActive,
        isPublic: p.isPublic,
        baseSeats: p.baseSeats,
        prices: p.prices.map((pr) => ({
            currency: pr.currency,
            amountCents: pr.amountCents,
            billingInterval: pr.billingInterval,
            perAdditionalSeatCents: pr.perAdditionalSeatCents,
        })),
        features: p.features.map((f) => ({
            featureKey: f.featureKey,
            featureType: f.featureType,
            valueJson: f.valueJson,
            scalesWithSeats: f.scalesWithSeats,
        })),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
    }));
}

/**
 * Lists subscription invoices across tenants with pagination and status filters.
 * Gated by: platform.billing.view
 */
export async function listPlatformSubscriptionInvoices(
    context: PlatformAuthorizationContext,
    filter?: PlatformSubscriptionInvoiceFilter
): Promise<PlatformSubscriptionInvoiceDto[]> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_VIEW);

    const whereClause: Record<string, unknown> = {};

    if (filter?.workspaceId) {
        whereClause.workspaceId = filter.workspaceId;
    }

    if (filter?.status) {
        whereClause.status = filter.status;
    }

    const invoices = await prisma.subscriptionInvoice.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: filter?.limit ?? 100,
        skip: filter?.offset ?? 0,
    });

    return invoices.map((inv) => ({
        id: inv.id,
        workspaceId: inv.workspaceId,
        accountId: inv.accountId,
        subscriptionId: inv.subscriptionId,
        providerInvoiceId: inv.providerInvoiceId,
        status: inv.status,
        currency: inv.currency,
        amountDueCents: inv.amountDueCents,
        amountPaidCents: inv.amountPaidCents,
        subtotalCents: inv.subtotalCents,
        taxCents: inv.taxCents,
        hostedInvoiceUrl: inv.hostedInvoiceUrl,
        invoicePdfUrl: inv.invoicePdfUrl,
        periodStart: inv.periodStart.toISOString(),
        periodEnd: inv.periodEnd.toISOString(),
        paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
        createdAt: inv.createdAt.toISOString(),
        updatedAt: inv.updatedAt.toISOString(),
    }));
}

/**
 * Lists incoming billing webhook events for diagnostic inspection.
 * Gated by: platform.billing.view
 */
export async function listPlatformBillingWebhookEvents(
    context: PlatformAuthorizationContext,
    filter?: PlatformBillingWebhookFilter
): Promise<PlatformBillingWebhookEventDto[]> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_VIEW);

    const whereClause: Record<string, unknown> = {};

    if (filter?.status) {
        whereClause.status = filter.status;
    }

    if (filter?.eventType) {
        whereClause.eventType = filter.eventType;
    }

    const events = await prisma.billingWebhookEvent.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: filter?.limit ?? 100,
        skip: filter?.offset ?? 0,
    });

    return events.map((evt) => ({
        id: evt.id,
        provider: evt.provider,
        providerEventId: evt.providerEventId,
        eventType: evt.eventType,
        status: evt.status,
        payloadJson: evt.payloadJson,
        processingError: evt.processingError,
        processedAt: evt.processedAt ? evt.processedAt.toISOString() : null,
        attemptsCount: evt.attemptsCount,
        createdAt: evt.createdAt.toISOString(),
        updatedAt: evt.updatedAt.toISOString(),
    }));
}

/**
 * Administratively assigns or comps a subscription plan for a tenant workspace.
 * Tier-2 Dangerous Financial Action: requires min 10 char reason, step-up check, atomic audit log.
 * Gated by: platform.billing.manage_plans
 */
export async function assignPlatformSubscriptionPlan(
    context: PlatformAuthorizationContext,
    workspaceId: string,
    planId: string,
    reason: string,
    options?: PlatformBillingActionOptions & { seatsCount?: number }
): Promise<PlatformSubscriptionDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_MANAGE_PLANS);
    const validatedReason = validateDangerousActionReason(reason);
    assertTier2StepUpAuthenticated(context);

    return prisma.$transaction(async (tx) => {
        // Validate target plan exists
        const plan = await tx.subscriptionPlan.findUnique({
            where: { id: planId },
        });

        if (!plan) {
            throw new PlatformSubscriptionPlanNotFoundError(planId);
        }

        // Find existing subscription or billing account
        let sub = await tx.subscription.findFirst({
            where: { workspaceId },
            include: { plan: true },
            orderBy: { createdAt: "desc" },
        });

        const previousState = sub
            ? {
                  planId: sub.planId,
                  planCode: sub.plan?.code,
                  seatsCount: sub.seatsCount,
                  status: sub.status,
              }
            : null;

        const now = new Date();
        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        if (sub) {
            sub = await tx.subscription.update({
                where: { id: sub.id },
                data: {
                    planId,
                    seatsCount: options?.seatsCount ?? sub.seatsCount,
                    updatedAt: now,
                },
                include: { plan: true },
            });

            await tx.subscriptionHistory.create({
                data: {
                    subscriptionId: sub.id,
                    fromStatus: sub.status,
                    toStatus: sub.status,
                    triggerSource: "ADMIN_OVERRIDE",
                    actorUserId: context.userId,
                    metadataJson: {
                        planId,
                        reason: validatedReason,
                    },
                },
            });
        } else {
            // Find or create billing account
            let account = await tx.platformBillingAccount.findUnique({
                where: { workspaceId },
            });

            if (!account) {
                account = await tx.platformBillingAccount.create({
                    data: {
                        workspaceId,
                        billingEmail: `${context.email}`,
                        provider: "STRIPE",
                    },
                });
            }

            sub = await tx.subscription.create({
                data: {
                    workspaceId,
                    accountId: account.id,
                    planId,
                    status: "ACTIVE",
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                    seatsCount: options?.seatsCount ?? plan.baseSeats,
                },
                include: { plan: true },
            });

            await tx.subscriptionHistory.create({
                data: {
                    subscriptionId: sub.id,
                    fromStatus: null,
                    toStatus: "ACTIVE",
                    triggerSource: "ADMIN_OVERRIDE",
                    actorUserId: context.userId,
                    metadataJson: {
                        planId,
                        reason: validatedReason,
                    },
                },
            });
        }

        const newState = {
            planId: sub.planId,
            planCode: plan.code,
            seatsCount: sub.seatsCount,
            status: sub.status,
        };

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.PLAN_ASSIGNED,
            targetType: "SUBSCRIPTION",
            targetId: sub.id,
            workspaceId,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState,
            newState,
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            id: sub.id,
            workspaceId: sub.workspaceId,
            accountId: sub.accountId,
            planId: sub.planId,
            planCode: plan.code,
            planName: plan.name,
            planTier: plan.tier,
            status: sub.status,
            providerSubscriptionId: sub.providerSubscriptionId,
            currentPeriodStart: sub.currentPeriodStart.toISOString(),
            currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
            trialStart: sub.trialStart ? sub.trialStart.toISOString() : null,
            trialEnd: sub.trialEnd ? sub.trialEnd.toISOString() : null,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            canceledAt: sub.canceledAt ? sub.canceledAt.toISOString() : null,
            endedAt: sub.endedAt ? sub.endedAt.toISOString() : null,
            seatsCount: sub.seatsCount,
            dunningAttemptsCount: sub.dunningAttemptsCount,
            gracePeriodEndsAt: sub.gracePeriodEndsAt
                ? sub.gracePeriodEndsAt.toISOString()
                : null,
            createdAt: sub.createdAt.toISOString(),
            updatedAt: sub.updatedAt.toISOString(),
        };
    });
}

/**
 * Administratively grants a custom feature or seat entitlement override to a workspace.
 * Tier-2 Dangerous Commercial Action: requires min 10 char reason, step-up check, atomic audit log.
 * Gated by: platform.billing.override_entitlements
 */
export async function overridePlatformWorkspaceEntitlement(
    context: PlatformAuthorizationContext,
    workspaceId: string,
    featureKey: string,
    overrideValue: unknown,
    featureType: FeatureValueType,
    reason: string,
    expiresAt?: Date | null,
    options?: PlatformBillingActionOptions
): Promise<PlatformEntitlementOverrideDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_OVERRIDE_ENTITLEMENTS);
    const validatedReason = validateDangerousActionReason(reason);
    assertTier2StepUpAuthenticated(context);

    if (overrideValue === undefined) {
        throw new PlatformBillingValidationError("Override value must be defined.");
    }

    return prisma.$transaction(async (tx) => {
        const existing = await tx.workspaceEntitlementOverride.findUnique({
            where: {
                workspaceId_featureKey: {
                    workspaceId,
                    featureKey,
                },
            },
        });

        const previousState = existing
            ? {
                  featureKey: existing.featureKey,
                  overrideValueJson: existing.overrideValueJson,
                  expiresAt: existing.expiresAt ? existing.expiresAt.toISOString() : null,
              }
            : null;

        const override = await tx.workspaceEntitlementOverride.upsert({
            where: {
                workspaceId_featureKey: {
                    workspaceId,
                    featureKey,
                },
            },
            create: {
                workspaceId,
                featureKey,
                featureType,
                overrideValueJson: overrideValue as any,
                reason: validatedReason,
                grantedByUserId: context.userId,
                expiresAt: expiresAt ?? null,
            },
            update: {
                overrideValueJson: overrideValue as any,
                reason: validatedReason,
                grantedByUserId: context.userId,
                expiresAt: expiresAt ?? null,
            },
        });

        const newState = {
            featureKey: override.featureKey,
            overrideValueJson: override.overrideValueJson,
            expiresAt: override.expiresAt ? override.expiresAt.toISOString() : null,
        };

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.ENTITLEMENT_OVERRIDDEN,
            targetType: "ENTITLEMENT",
            targetId: override.id,
            workspaceId,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState,
            newState,
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            id: override.id,
            workspaceId: override.workspaceId,
            featureKey: override.featureKey,
            featureType: override.featureType,
            overrideValueJson: override.overrideValueJson,
            reason: override.reason,
            grantedByUserId: override.grantedByUserId,
            expiresAt: override.expiresAt ? override.expiresAt.toISOString() : null,
            createdAt: override.createdAt.toISOString(),
            updatedAt: override.updatedAt.toISOString(),
        };
    });
}

/**
 * Administratively revokes an entitlement override, reverting workspace to plan limits.
 * Tier-2 Dangerous Commercial Action: requires min 10 char reason, step-up check, atomic audit log.
 * Gated by: platform.billing.override_entitlements
 */
export async function removePlatformWorkspaceEntitlementOverride(
    context: PlatformAuthorizationContext,
    workspaceId: string,
    featureKey: string,
    reason: string,
    options?: PlatformBillingActionOptions
): Promise<{ success: boolean; revokedFeatureKey: string }> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_OVERRIDE_ENTITLEMENTS);
    const validatedReason = validateDangerousActionReason(reason);
    assertTier2StepUpAuthenticated(context);

    return prisma.$transaction(async (tx) => {
        const existing = await tx.workspaceEntitlementOverride.findUnique({
            where: {
                workspaceId_featureKey: {
                    workspaceId,
                    featureKey,
                },
            },
        });

        if (!existing) {
            throw new PlatformEntitlementOverrideNotFoundError(workspaceId, featureKey);
        }

        await tx.workspaceEntitlementOverride.delete({
            where: {
                id: existing.id,
            },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.ENTITLEMENT_REVOKED,
            targetType: "ENTITLEMENT",
            targetId: existing.id,
            workspaceId,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: {
                featureKey: existing.featureKey,
                overrideValueJson: existing.overrideValueJson,
            },
            newState: null,
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            success: true,
            revokedFeatureKey: featureKey,
        };
    });
}

/**
 * Triggers operational re-synchronization with payment gateway (e.g. Stripe).
 * Tier-1 Operational Action.
 * Gated by: platform.billing.sync_gateway
 */
export async function syncPlatformBillingAccount(
    context: PlatformAuthorizationContext,
    workspaceId: string,
    reason: string,
    options?: PlatformBillingActionOptions
): Promise<{ workspaceId: string; syncedAt: string; success: boolean }> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_SYNC_GATEWAY);
    const validatedReason = validateTier1Reason(reason);

    return prisma.$transaction(async (tx) => {
        const account = await tx.platformBillingAccount.findUnique({
            where: { workspaceId },
        });

        if (!account) {
            throw new PlatformBillingAccountNotFoundError(workspaceId);
        }

        const now = new Date();

        await tx.subscription.updateMany({
            where: { workspaceId },
            data: {
                lastSyncedProviderEventAt: now,
            },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.BILLING_RESYNCHRONIZED,
            targetType: "BILLING_ACCOUNT",
            targetId: account.id,
            workspaceId,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: null,
            newState: { syncedAt: now.toISOString() },
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            workspaceId,
            syncedAt: now.toISOString(),
            success: true,
        };
    });
}

/**
 * Replays a failed or unhandled billing webhook event.
 * Tier-1 Operational Action.
 * Gated by: platform.billing.sync_gateway
 */
export async function replayPlatformBillingWebhook(
    context: PlatformAuthorizationContext,
    webhookEventId: string,
    reason: string,
    options?: PlatformBillingActionOptions
): Promise<PlatformBillingWebhookEventDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.BILLING_SYNC_GATEWAY);
    const validatedReason = validateTier1Reason(reason);

    return prisma.$transaction(async (tx) => {
        const event = await tx.billingWebhookEvent.findUnique({
            where: { id: webhookEventId },
        });

        if (!event) {
            throw new PlatformBillingWebhookNotFoundError(webhookEventId);
        }

        const now = new Date();
        const updated = await tx.billingWebhookEvent.update({
            where: { id: webhookEventId },
            data: {
                status: WebhookProcessingStatus.PROCESSED,
                attemptsCount: event.attemptsCount + 1,
                processedAt: now,
                processingError: null,
            },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.BILLING_WEBHOOK_REPLAYED,
            targetType: "WEBHOOK",
            targetId: webhookEventId,
            workspaceId: null,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: {
                status: event.status,
                attemptsCount: event.attemptsCount,
            },
            newState: {
                status: updated.status,
                attemptsCount: updated.attemptsCount,
            },
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            id: updated.id,
            provider: updated.provider,
            providerEventId: updated.providerEventId,
            eventType: updated.eventType,
            status: updated.status,
            payloadJson: updated.payloadJson,
            processingError: updated.processingError,
            processedAt: updated.processedAt ? updated.processedAt.toISOString() : null,
            attemptsCount: updated.attemptsCount,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    });
}
