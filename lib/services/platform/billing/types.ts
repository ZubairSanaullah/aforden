import {
    SubscriptionStatus,
    BillingInterval,
    BillingProviderType,
    SubscriptionInvoiceStatus,
    SubscriptionPaymentStatus,
    WebhookProcessingStatus,
    PlanTier,
    FeatureValueType,
} from "@/generated/prisma/enums";

export {
    SubscriptionStatus,
    BillingInterval,
    BillingProviderType,
    SubscriptionInvoiceStatus,
    SubscriptionPaymentStatus,
    WebhookProcessingStatus,
    PlanTier,
    FeatureValueType,
};

/**
 * Sanitized Billing Account DTO.
 * PCI DSS Invariant: Full card numbers (PAN), CVVs, and payment processor private API keys
 * are NEVER received, stored, or exposed. Only display indicators (brand, last4) are retained.
 */
export interface PlatformBillingAccountDto {
    id: string;
    workspaceId: string;
    workspaceName?: string;
    workspaceSlug?: string;
    billingEmail: string;
    billingName: string | null;
    taxId: string | null;
    provider: BillingProviderType;
    providerCustomerId: string | null;
    paymentMethodBrand: string | null;
    paymentMethodLast4: string | null;
    paymentMethodExpMonth: number | null;
    paymentMethodExpYear: number | null;
    delinquentSince: string | null;
    activeSubscription?: PlatformSubscriptionDto | null;
    createdAt: string;
    updatedAt: string;
}

export interface PlatformSubscriptionDto {
    id: string;
    workspaceId: string;
    accountId: string;
    planId: string;
    planCode?: string;
    planName?: string;
    planTier?: PlanTier;
    status: SubscriptionStatus;
    providerSubscriptionId: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    trialStart: string | null;
    trialEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    endedAt: string | null;
    seatsCount: number;
    dunningAttemptsCount: number;
    gracePeriodEndsAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PlatformSubscriptionPlanPriceDto {
    currency: string;
    amountCents: number;
    billingInterval: BillingInterval;
    perAdditionalSeatCents: number;
}

export interface PlatformSubscriptionPlanDto {
    id: string;
    code: string;
    name: string;
    tier: PlanTier;
    description: string | null;
    isActive: boolean;
    isPublic: boolean;
    baseSeats: number;
    prices?: PlatformSubscriptionPlanPriceDto[];
    features?: Array<{
        featureKey: string;
        featureType: FeatureValueType;
        valueJson: unknown;
        scalesWithSeats: boolean;
    }>;
    createdAt: string;
    updatedAt: string;
}

export interface PlatformEntitlementOverrideDto {
    id: string;
    workspaceId: string;
    featureKey: string;
    featureType: FeatureValueType;
    overrideValueJson: unknown;
    reason: string;
    grantedByUserId: string;
    expiresAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PlatformSubscriptionInvoiceDto {
    id: string;
    workspaceId: string;
    accountId: string;
    subscriptionId: string | null;
    providerInvoiceId: string | null;
    status: SubscriptionInvoiceStatus;
    currency: string;
    amountDueCents: number;
    amountPaidCents: number;
    subtotalCents: number;
    taxCents: number;
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
    periodStart: string;
    periodEnd: string;
    paidAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PlatformBillingWebhookEventDto {
    id: string;
    provider: BillingProviderType;
    providerEventId: string;
    eventType: string;
    status: WebhookProcessingStatus;
    payloadJson: unknown;
    processingError: string | null;
    processedAt: string | null;
    attemptsCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface PlatformBillingAccountFilter {
    workspaceId?: string;
    provider?: BillingProviderType;
    isDelinquent?: boolean;
    limit?: number;
    offset?: number;
}

export interface PlatformSubscriptionInvoiceFilter {
    workspaceId?: string;
    status?: SubscriptionInvoiceStatus;
    limit?: number;
    offset?: number;
}

export interface PlatformBillingWebhookFilter {
    status?: WebhookProcessingStatus;
    eventType?: string;
    limit?: number;
    offset?: number;
}

export interface PlatformBillingActionOptions {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string | null;
    metadata?: Record<string, unknown> | null;
}
