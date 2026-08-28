/**
 * Phase 1.15.2 — Entitlement Registry (Closed Compile-Time Allowlist)
 * Defines the canonical, immutable catalog of platform feature flags and numeric quotas.
 */

import type { FeatureValueType } from "@/generated/prisma/enums";

export const ENTITLEMENT_REGISTRY = {
  // Numeric Quotas
  MAX_MEMBERS: {
    key: "MAX_MEMBERS",
    type: "NUMERIC_LIMIT" as FeatureValueType,
    defaultValue: 2, // Absolute free tier limit
    scalesWithSeats: true, // Multiplier when active subscription (1 per seat)
    description: "Maximum active user accounts in the workspace",
  },
  MAX_TECHNICIANS: {
    key: "MAX_TECHNICIANS",
    type: "NUMERIC_LIMIT" as FeatureValueType,
    defaultValue: 1,
    scalesWithSeats: false,
    description: "Maximum active technician profiles with dispatch scheduling",
  },
  MAX_WORK_ORDERS_PER_MONTH: {
    key: "MAX_WORK_ORDERS_PER_MONTH",
    type: "NUMERIC_LIMIT" as FeatureValueType,
    defaultValue: 25,
    scalesWithSeats: false,
    description: "Maximum work orders created within a single calendar month",
  },
  MAX_SERVICE_LOCATIONS: {
    key: "MAX_SERVICE_LOCATIONS",
    type: "NUMERIC_LIMIT" as FeatureValueType,
    defaultValue: 50,
    scalesWithSeats: false,
    description: "Maximum active customer service location records",
  },
  MAX_ATTACHMENT_STORAGE_MB: {
    key: "MAX_ATTACHMENT_STORAGE_MB",
    type: "NUMERIC_LIMIT" as FeatureValueType,
    defaultValue: 500,
    scalesWithSeats: false,
    description: "Total file attachment and photo evidence storage capacity in MB",
  },

  // Boolean Feature Flags
  FEATURE_ADVANCED_REPORTING: {
    key: "FEATURE_ADVANCED_REPORTING",
    type: "BOOLEAN" as FeatureValueType,
    defaultValue: false,
    scalesWithSeats: false,
    description: "Access to profitability, technician efficiency, and AR aging reports",
  },
  FEATURE_CUSTOM_BRANDING: {
    key: "FEATURE_CUSTOM_BRANDING",
    type: "BOOLEAN" as FeatureValueType,
    defaultValue: false,
    scalesWithSeats: false,
    description: "Custom logos, PDF color schemes, and email sender signatures",
  },
  FEATURE_SMS_NOTIFICATIONS: {
    key: "FEATURE_SMS_NOTIFICATIONS",
    type: "BOOLEAN" as FeatureValueType,
    defaultValue: false,
    scalesWithSeats: false,
    description: "Direct SMS notification dispatches to customers and field techs",
  },
  FEATURE_INVENTORY_MULTI_WAREHOUSE: {
    key: "FEATURE_INVENTORY_MULTI_WAREHOUSE",
    type: "BOOLEAN" as FeatureValueType,
    defaultValue: false,
    scalesWithSeats: false,
    description: "Tracking inventory across multiple physical warehouses and trucks",
  },
  FEATURE_API_ACCESS: {
    key: "FEATURE_API_ACCESS",
    type: "BOOLEAN" as FeatureValueType,
    defaultValue: false,
    scalesWithSeats: false,
    description: "Access to public developer REST APIs and webhooks",
  },
  FEATURE_AUTOMATIONS: {
    key: "FEATURE_AUTOMATIONS",
    type: "BOOLEAN" as FeatureValueType,
    defaultValue: false,
    scalesWithSeats: false,
    description: "Access to automated workflows, trigger ingestion, and execution pipelines",
  },
} as const;

// Ensure runtime immutability
Object.freeze(ENTITLEMENT_REGISTRY);
for (const key of Object.keys(ENTITLEMENT_REGISTRY)) {
  Object.freeze(ENTITLEMENT_REGISTRY[key as keyof typeof ENTITLEMENT_REGISTRY]);
}

export type EntitlementKey = keyof typeof ENTITLEMENT_REGISTRY;

export const ENTITLEMENT_KEYS = Object.keys(ENTITLEMENT_REGISTRY) as readonly EntitlementKey[];

export function isEntitlementKey(key: string): key is EntitlementKey {
  return Object.prototype.hasOwnProperty.call(ENTITLEMENT_REGISTRY, key);
}

export function getEntitlementDefinition(key: EntitlementKey) {
  return ENTITLEMENT_REGISTRY[key];
}
