import { prisma } from "@/lib/prisma";
import type { Prisma, PlanTier, SubscriptionStatus, OrganizationStatus } from "@/generated/prisma/client";
import {
    PlatformAuthorizationContext,
    PLATFORM_PERMISSIONS,
    assertPlatformPermission,
    hasPlatformPermission,
} from "../authorization";
import {
    PlatformWorkspaceSummaryDto,
    PlatformWorkspaceDetailDto,
    PlatformWorkspacesFilter,
    PlatformWorkspaceOwnerDto,
    PlatformWorkspaceSubscriptionDto,
    PlatformWorkspaceOrganizationDto,
    PlatformWorkspaceBillingAccountDto,
    PlatformWorkspaceCountsDto,
} from "./types";

/**
 * Maps raw database workspace entity into a sanitized PlatformWorkspaceSummaryDto.
 * Conditionally includes subscription details based on caller's platform.billing.view permission.
 */
function mapWorkspaceToSummaryDto(
    workspace: any,
    canViewBilling: boolean
): PlatformWorkspaceSummaryDto {
    const ownerMembership = workspace.memberships?.[0];
    const owner: PlatformWorkspaceOwnerDto | null = ownerMembership?.user
        ? {
              userId: ownerMembership.user.id,
              name: ownerMembership.user.name,
              email: ownerMembership.user.email,
              avatarUrl: ownerMembership.user.avatarUrl,
          }
        : null;

    const organization: PlatformWorkspaceOrganizationDto | null = workspace.organization
        ? {
              businessName: workspace.organization.businessName,
              legalName: workspace.organization.legalName,
              email: workspace.organization.email,
              phone: workspace.organization.phone,
              website: workspace.organization.website,
              status: workspace.organization.status,
          }
        : null;

    const activeSubscription = canViewBilling ? workspace.subscriptions?.[0] : null;
    const subscription: PlatformWorkspaceSubscriptionDto | null = activeSubscription
        ? {
              id: activeSubscription.id,
              status: activeSubscription.status,
              planTier: activeSubscription.plan.tier,
              planName: activeSubscription.plan.name,
              planCode: activeSubscription.plan.code,
              seatsCount: activeSubscription.seatsCount,
              currentPeriodStart: activeSubscription.currentPeriodStart,
              currentPeriodEnd: activeSubscription.currentPeriodEnd,
              trialEnd: activeSubscription.trialEnd,
              cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
              dunningAttemptsCount: activeSubscription.dunningAttemptsCount,
              gracePeriodEndsAt: activeSubscription.gracePeriodEndsAt,
          }
        : null;

    return {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        logoUrl: workspace.logoUrl,
        timezone: workspace.timezone,
        defaultCurrencyCode: workspace.defaultCurrencyCode,
        organization,
        owner,
        subscription,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
    };
}

/**
 * Retrieves a paginated list of workspaces across the entire platform.
 * 
 * Global Cross-Tenant Visibility:
 * Deliberately queries across ALL workspaces without tenant filtering.
 * Strictly gated by platform.workspaces.view permission.
 * Billing & Subscription details are conditionally masked if caller lacks platform.billing.view.
 */
export async function getWorkspaces(
    context: PlatformAuthorizationContext,
    filters?: PlatformWorkspacesFilter
): Promise<{
    workspaces: PlatformWorkspaceSummaryDto[];
    total: number;
}> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.WORKSPACES_VIEW);
    const canViewBilling = hasPlatformPermission(
        context,
        PLATFORM_PERMISSIONS.BILLING_VIEW
    );

    const where: Prisma.WorkspaceWhereInput = {};

    if (filters?.search) {
        where.OR = [
            { name: { contains: filters.search, mode: "insensitive" } },
            { slug: { contains: filters.search, mode: "insensitive" } },
            {
                organization: {
                    businessName: { contains: filters.search, mode: "insensitive" },
                },
            },
        ];
    }

    if (filters?.status) {
        where.organization = {
            status: filters.status as OrganizationStatus,
        };
    }

    if (filters?.planTier || filters?.planCode || filters?.subscriptionStatus) {
        const subscriptionWhere: Prisma.SubscriptionWhereInput = {};
        if (filters.subscriptionStatus) {
            subscriptionWhere.status = filters.subscriptionStatus as SubscriptionStatus;
        }
        if (filters.planTier || filters.planCode) {
            subscriptionWhere.plan = {};
            if (filters.planTier) {
                subscriptionWhere.plan.tier = filters.planTier as PlanTier;
            }
            if (filters.planCode) {
                subscriptionWhere.plan.code = filters.planCode;
            }
        }
        where.subscriptions = {
            some: subscriptionWhere,
        };
    }

    if (filters?.ownerUserId || filters?.ownerEmail) {
        const membershipWhere: Prisma.WorkspaceMemberWhereInput = {
            role: "OWNER",
        };
        if (filters.ownerUserId) {
            membershipWhere.userId = filters.ownerUserId;
        }
        if (filters.ownerEmail) {
            membershipWhere.user = {
                email: { contains: filters.ownerEmail, mode: "insensitive" },
            };
        }
        where.memberships = {
            some: membershipWhere,
        };
    }

    if (filters?.createdAfter || filters?.createdBefore) {
        where.createdAt = {};
        if (filters.createdAfter) {
            where.createdAt.gte = filters.createdAfter;
        }
        if (filters.createdBefore) {
            where.createdAt.lte = filters.createdBefore;
        }
    }

    const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
    const offset = Math.max(filters?.offset ?? 0, 0);

    const sortBy = filters?.sortBy ?? "createdAt";
    const sortOrder = filters?.sortOrder ?? "desc";

    const [workspaces, total] = await Promise.all([
        prisma.workspace.findMany({
            where,
            orderBy: { [sortBy]: sortOrder },
            take: limit,
            skip: offset,
            select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                timezone: true,
                defaultCurrencyCode: true,
                createdAt: true,
                updatedAt: true,
                organization: {
                    select: {
                        businessName: true,
                        legalName: true,
                        email: true,
                        phone: true,
                        website: true,
                        status: true,
                    },
                },
                memberships: {
                    where: { role: "OWNER" },
                    select: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                avatarUrl: true,
                            },
                        },
                    },
                    take: 1,
                },
                subscriptions: {
                    orderBy: { createdAt: "desc" },
                    select: {
                        id: true,
                        status: true,
                        seatsCount: true,
                        currentPeriodStart: true,
                        currentPeriodEnd: true,
                        trialEnd: true,
                        cancelAtPeriodEnd: true,
                        dunningAttemptsCount: true,
                        gracePeriodEndsAt: true,
                        plan: {
                            select: {
                                tier: true,
                                name: true,
                                code: true,
                            },
                        },
                    },
                    take: 1,
                },
            },
        }),
        prisma.workspace.count({ where }),
    ]);

    return {
        workspaces: workspaces.map((w) =>
            mapWorkspaceToSummaryDto(w, canViewBilling)
        ),
        total,
    };
}

/**
 * Retrieves detailed diagnostics and configuration for a specific workspace.
 * Strictly gated by platform.workspaces.view permission.
 * Billing & Subscription details are conditionally masked if caller lacks platform.billing.view.
 */
export async function getWorkspace(
    context: PlatformAuthorizationContext,
    workspaceId: string
): Promise<PlatformWorkspaceDetailDto | null> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.WORKSPACES_VIEW);
    const canViewBilling = hasPlatformPermission(
        context,
        PLATFORM_PERMISSIONS.BILLING_VIEW
    );

    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            timezone: true,
            defaultCurrencyCode: true,
            createdAt: true,
            updatedAt: true,
            organization: {
                select: {
                    businessName: true,
                    legalName: true,
                    email: true,
                    phone: true,
                    website: true,
                    status: true,
                },
            },
            memberships: {
                where: { role: "OWNER" },
                select: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            avatarUrl: true,
                        },
                    },
                },
                take: 1,
            },
            subscriptions: {
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    status: true,
                    seatsCount: true,
                    currentPeriodStart: true,
                    currentPeriodEnd: true,
                    trialEnd: true,
                    cancelAtPeriodEnd: true,
                    dunningAttemptsCount: true,
                    gracePeriodEndsAt: true,
                    plan: {
                        select: {
                            tier: true,
                            name: true,
                            code: true,
                        },
                    },
                },
                take: 1,
            },
            platformBillingAccount: {
                select: {
                    billingEmail: true,
                    billingName: true,
                    paymentMethodBrand: true,
                    paymentMethodLast4: true,
                    delinquentSince: true,
                },
            },
            _count: {
                select: {
                    memberships: true,
                    workOrders: true,
                    customers: true,
                    assets: true,
                    developerApplications: true,
                },
            },
        },
    });

    if (!workspace) {
        return null;
    }

    const summary = mapWorkspaceToSummaryDto(workspace, canViewBilling);

    const billingAccount: PlatformWorkspaceBillingAccountDto | null =
        canViewBilling && workspace.platformBillingAccount
            ? {
                  billingEmail: workspace.platformBillingAccount.billingEmail,
                  billingName: workspace.platformBillingAccount.billingName,
                  paymentMethodBrand: workspace.platformBillingAccount.paymentMethodBrand,
                  paymentMethodLast4: workspace.platformBillingAccount.paymentMethodLast4,
                  delinquentSince: workspace.platformBillingAccount.delinquentSince,
              }
            : null;

    const counts: PlatformWorkspaceCountsDto = {
        membersCount: workspace._count?.memberships ?? 0,
        workOrdersCount: workspace._count?.workOrders ?? 0,
        customersCount: workspace._count?.customers ?? 0,
        assetsCount: workspace._count?.assets ?? 0,
        activeApplicationsCount: workspace._count?.developerApplications ?? 0,
    };

    return {
        ...summary,
        billingAccount,
        counts,
    };
}
