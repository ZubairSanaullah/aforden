import {
    PlanTier,
    SubscriptionStatus,
    OrganizationStatus,
} from "@/generated/prisma/client";

export interface PlatformWorkspaceOwnerDto {
    userId: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
}

export interface PlatformWorkspaceOrganizationDto {
    businessName: string;
    legalName: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    status: OrganizationStatus;
}

export interface PlatformWorkspaceSubscriptionDto {
    id: string;
    status: SubscriptionStatus;
    planTier: PlanTier;
    planName: string;
    planCode: string;
    seatsCount: number;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    trialEnd: Date | null;
    cancelAtPeriodEnd: Boolean;
    dunningAttemptsCount: number;
    gracePeriodEndsAt: Date | null;
}

export interface PlatformWorkspaceBillingAccountDto {
    billingEmail: string;
    billingName: string | null;
    paymentMethodBrand: string | null;
    paymentMethodLast4: string | null;
    delinquentSince: Date | null;
}

export interface PlatformWorkspaceCountsDto {
    membersCount: number;
    workOrdersCount: number;
    customersCount: number;
    assetsCount: number;
    activeApplicationsCount: number;
}

/**
 * Summary DTO returned by getWorkspaces() list operation.
 * Sanitized for platform operator visibility without exposing internal security secrets.
 */
export interface PlatformWorkspaceSummaryDto {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    timezone: string;
    defaultCurrencyCode: string;
    organization: PlatformWorkspaceOrganizationDto | null;
    owner: PlatformWorkspaceOwnerDto | null;
    subscription: PlatformWorkspaceSubscriptionDto | null;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Detailed DTO returned by getWorkspace() lookup.
 * Includes entity counts and billing profile for operator diagnostics.
 */
export interface PlatformWorkspaceDetailDto extends PlatformWorkspaceSummaryDto {
    billingAccount: PlatformWorkspaceBillingAccountDto | null;
    counts: PlatformWorkspaceCountsDto;
}

export interface PlatformWorkspacesFilter {
    search?: string;
    status?: OrganizationStatus | string;
    planTier?: PlanTier | string;
    planCode?: string;
    subscriptionStatus?: SubscriptionStatus | string;
    ownerUserId?: string;
    ownerEmail?: string;
    createdAfter?: Date;
    createdBefore?: Date;
    limit?: number;
    offset?: number;
    sortBy?: "name" | "createdAt" | "slug";
    sortOrder?: "asc" | "desc";
}
