/**
 * Phase 1.15.2 — Seed Standard Subscription Plans
 * Idempotently seeds Starter, Growth, and Enterprise subscription plans with prices and feature entitlements.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import {
  BillingInterval,
  PlanTier,
  FeatureValueType,
} from "@/generated/prisma/enums";
import { ENTITLEMENT_REGISTRY, ENTITLEMENT_KEYS } from "./entitlementRegistry";

export interface SeedPlanData {
  code: string;
  name: string;
  tier: PlanTier;
  description: string;
  baseSeats: number;
  sortOrder: number;
  prices: {
    billingInterval: BillingInterval;
    amountCents: number;
    perAdditionalSeatCents: number;
    currency: string;
    providerPriceId?: string;
  }[];
  features: Record<
    string,
    {
      valueJson: number | boolean | string;
      featureType?: FeatureValueType;
      scalesWithSeats?: boolean;
    }
  >;
}

export const SEED_SUBSCRIPTION_PLANS: SeedPlanData[] = [
  {
    code: "starter",
    name: "Starter Plan",
    tier: PlanTier.STARTER,
    description: "Essential field operations for small teams and growing contractors",
    baseSeats: 1,
    sortOrder: 1,
    prices: [
      {
        billingInterval: BillingInterval.MONTHLY,
        amountCents: 4900,
        perAdditionalSeatCents: 2900,
        currency: "USD",
        providerPriceId: "price_starter_monthly_mock",
      },
      {
        billingInterval: BillingInterval.ANNUAL,
        amountCents: 46800,
        perAdditionalSeatCents: 27600,
        currency: "USD",
        providerPriceId: "price_starter_annual_mock",
      },
    ],
    features: {
      MAX_MEMBERS: { valueJson: 1, scalesWithSeats: true, featureType: FeatureValueType.NUMERIC_LIMIT },
      MAX_TECHNICIANS: { valueJson: 3, scalesWithSeats: false, featureType: FeatureValueType.NUMERIC_LIMIT },
      MAX_WORK_ORDERS_PER_MONTH: { valueJson: 100, scalesWithSeats: false, featureType: FeatureValueType.NUMERIC_LIMIT },
      MAX_SERVICE_LOCATIONS: { valueJson: 100, scalesWithSeats: false, featureType: FeatureValueType.NUMERIC_LIMIT },
      MAX_ATTACHMENT_STORAGE_MB: { valueJson: 1000, scalesWithSeats: false, featureType: FeatureValueType.NUMERIC_LIMIT },
      FEATURE_ADVANCED_REPORTING: { valueJson: false, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_CUSTOM_BRANDING: { valueJson: false, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_SMS_NOTIFICATIONS: { valueJson: false, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_INVENTORY_MULTI_WAREHOUSE: { valueJson: false, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_API_ACCESS: { valueJson: false, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_AUTOMATIONS: { valueJson: false, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
    },
  },
  {
    code: "growth",
    name: "Growth Plan",
    tier: PlanTier.GROWTH,
    description: "Advanced scheduling, multi-technician dispatch, and comprehensive business reporting",
    baseSeats: 5,
    sortOrder: 2,
    prices: [
      {
        billingInterval: BillingInterval.MONTHLY,
        amountCents: 14900,
        perAdditionalSeatCents: 2500,
        currency: "USD",
        providerPriceId: "price_growth_monthly_mock",
      },
      {
        billingInterval: BillingInterval.ANNUAL,
        amountCents: 142800,
        perAdditionalSeatCents: 24000,
        currency: "USD",
        providerPriceId: "price_growth_annual_mock",
      },
    ],
    features: {
      MAX_MEMBERS: { valueJson: 1, scalesWithSeats: true, featureType: FeatureValueType.NUMERIC_LIMIT },
      MAX_TECHNICIANS: { valueJson: 15, scalesWithSeats: false, featureType: FeatureValueType.NUMERIC_LIMIT },
      MAX_WORK_ORDERS_PER_MONTH: { valueJson: 500, scalesWithSeats: false, featureType: FeatureValueType.NUMERIC_LIMIT },
      MAX_SERVICE_LOCATIONS: { valueJson: 1000, scalesWithSeats: false, featureType: FeatureValueType.NUMERIC_LIMIT },
      MAX_ATTACHMENT_STORAGE_MB: { valueJson: 10000, scalesWithSeats: false, featureType: FeatureValueType.NUMERIC_LIMIT },
      FEATURE_ADVANCED_REPORTING: { valueJson: true, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_CUSTOM_BRANDING: { valueJson: true, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_SMS_NOTIFICATIONS: { valueJson: true, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_INVENTORY_MULTI_WAREHOUSE: { valueJson: false, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_API_ACCESS: { valueJson: false, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_AUTOMATIONS: { valueJson: true, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
    },
  },
  {
    code: "enterprise",
    name: "Enterprise Plan",
    tier: PlanTier.ENTERPRISE,
    description: "Unlimited operational capacity, custom integrations, dedicated warehousing and developer APIs",
    baseSeats: 20,
    sortOrder: 3,
    prices: [
      {
        billingInterval: BillingInterval.MONTHLY,
        amountCents: 49900,
        perAdditionalSeatCents: 2000,
        currency: "USD",
        providerPriceId: "price_enterprise_monthly_mock",
      },
      {
        billingInterval: BillingInterval.ANNUAL,
        amountCents: 478800,
        perAdditionalSeatCents: 19200,
        currency: "USD",
        providerPriceId: "price_enterprise_annual_mock",
      },
    ],
    features: {
      MAX_MEMBERS: { valueJson: 1, scalesWithSeats: true, featureType: FeatureValueType.NUMERIC_LIMIT },
      MAX_TECHNICIANS: { valueJson: "UNLIMITED", scalesWithSeats: false, featureType: FeatureValueType.STRING_VALUE },
      MAX_WORK_ORDERS_PER_MONTH: { valueJson: "UNLIMITED", scalesWithSeats: false, featureType: FeatureValueType.STRING_VALUE },
      MAX_SERVICE_LOCATIONS: { valueJson: "UNLIMITED", scalesWithSeats: false, featureType: FeatureValueType.STRING_VALUE },
      MAX_ATTACHMENT_STORAGE_MB: { valueJson: "UNLIMITED", scalesWithSeats: false, featureType: FeatureValueType.STRING_VALUE },
      FEATURE_ADVANCED_REPORTING: { valueJson: true, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_CUSTOM_BRANDING: { valueJson: true, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_SMS_NOTIFICATIONS: { valueJson: true, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_INVENTORY_MULTI_WAREHOUSE: { valueJson: true, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_API_ACCESS: { valueJson: true, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
      FEATURE_AUTOMATIONS: { valueJson: true, scalesWithSeats: false, featureType: FeatureValueType.BOOLEAN },
    },
  },
];

/**
 * Seed all default subscription plans into the database idempotently.
 */
export async function seedSubscriptionPlans(prisma: PrismaClient): Promise<{
  plansCount: number;
  pricesCount: number;
  featuresCount: number;
}> {
  let plansCount = 0;
  let pricesCount = 0;
  let featuresCount = 0;

  for (const planData of SEED_SUBSCRIPTION_PLANS) {
    // 1. Upsert SubscriptionPlan
    const plan = await prisma.subscriptionPlan.upsert({
      where: { code: planData.code },
      update: {
        name: planData.name,
        tier: planData.tier,
        description: planData.description,
        baseSeats: planData.baseSeats,
        sortOrder: planData.sortOrder,
        isActive: true,
        isPublic: true,
      },
      create: {
        code: planData.code,
        name: planData.name,
        tier: planData.tier,
        description: planData.description,
        baseSeats: planData.baseSeats,
        sortOrder: planData.sortOrder,
        isActive: true,
        isPublic: true,
      },
    });
    plansCount++;

    // 2. Upsert Prices sequentially to respect connection pool limits
    for (const price of planData.prices) {
      await prisma.subscriptionPlanPrice.upsert({
        where: {
          planId_billingInterval_currency: {
            planId: plan.id,
            billingInterval: price.billingInterval,
            currency: price.currency,
          },
        },
        update: {
          amountCents: price.amountCents,
          perAdditionalSeatCents: price.perAdditionalSeatCents,
          providerPriceId: price.providerPriceId,
          isActive: true,
        },
        create: {
          planId: plan.id,
          currency: price.currency,
          amountCents: price.amountCents,
          billingInterval: price.billingInterval,
          perAdditionalSeatCents: price.perAdditionalSeatCents,
          providerPriceId: price.providerPriceId,
          isActive: true,
        },
      });
      pricesCount++;
    }

    // 3. Upsert Features for all ENTITLEMENT_KEYS sequentially
    for (const key of ENTITLEMENT_KEYS) {
      const regDef = ENTITLEMENT_REGISTRY[key];
      const featureConfig = planData.features[key] || {
        valueJson: regDef.defaultValue,
        featureType: regDef.type,
        scalesWithSeats: regDef.scalesWithSeats,
      };

      const scalesWithSeats = featureConfig.scalesWithSeats ?? regDef.scalesWithSeats;
      const featureType = featureConfig.featureType ?? regDef.type;
      const valueJson = featureConfig.valueJson;

      // Seed-time validation assertion: scalesWithSeats features must be positive integer multiplier or UNLIMITED
      if (scalesWithSeats) {
        if (valueJson !== "UNLIMITED") {
          const numVal = Number(valueJson);
          if (!Number.isInteger(numVal) || numVal < 1) {
            throw new Error(
              `Invalid seed configuration for plan '${planData.code}' feature '${key}': ` +
                `scalesWithSeats=true requires positive integer multiplier >= 1, got '${String(valueJson)}'`
            );
          }
        }
      }

      await prisma.subscriptionPlanFeature.upsert({
        where: {
          planId_featureKey: {
            planId: plan.id,
            featureKey: key,
          },
        },
        update: {
          featureType,
          valueJson: valueJson as any,
          scalesWithSeats,
        },
        create: {
          planId: plan.id,
          featureKey: key,
          featureType,
          valueJson: valueJson as any,
          scalesWithSeats,
        },
      });
      featuresCount++;
    }
  }

  return { plansCount, pricesCount, featuresCount };
}
