/**
 * Phase 1.15.2 — SaaS Billing & Subscriptions Type Definitions
 */

import type {
  SubscriptionStatus,
  BillingInterval,
  BillingProviderType,
  SubscriptionInvoiceStatus,
  SubscriptionPaymentStatus,
  WebhookProcessingStatus,
  PlanTier,
  FeatureValueType,
} from "@/generated/prisma/enums";

export type {
  SubscriptionStatus,
  BillingInterval,
  BillingProviderType,
  SubscriptionInvoiceStatus,
  SubscriptionPaymentStatus,
  WebhookProcessingStatus,
  PlanTier,
  FeatureValueType,
};

export type EntitlementValue = number | boolean | string;

export interface EntitlementDefinition {
  readonly key: string;
  readonly type: FeatureValueType;
  readonly defaultValue: EntitlementValue;
  readonly scalesWithSeats: boolean;
  readonly description: string;
}

export type EntitlementSource = "WORKSPACE_OVERRIDE" | "SUBSCRIPTION_PLAN" | "DEFAULT_FALLBACK";

export interface ResolvedEntitlement {
  featureKey: string;
  value: EntitlementValue;
  source: EntitlementSource;
  isUnlimited: boolean;
  expiresAt: Date | null;
}
