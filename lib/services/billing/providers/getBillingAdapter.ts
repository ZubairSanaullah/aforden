/**
 * Phase 1.15.3 — Billing Provider Adapter Factory
 * Canonical resolver for obtaining BillingProviderAdapter instances.
 */

import { BillingProviderType } from "@/generated/prisma/enums";
import type { BillingProviderAdapter } from "./billingProviderAdapter";
import { StripeBillingAdapter } from "./stripeBillingAdapter";
import { MockBillingAdapter } from "./mockBillingAdapter";

/**
 * Returns the appropriate BillingProviderAdapter implementation based on the provider enum.
 * Throws on any unrecognized or unsupported provider type.
 */
export function getBillingAdapter(
  provider: BillingProviderType | string,
  options?: { apiKey?: string; webhookSecret?: string }
): BillingProviderAdapter {
  const normalized = typeof provider === "string" ? provider.trim().toUpperCase() : provider;
  switch (normalized) {
    case BillingProviderType.STRIPE:
    case "STRIPE":
      return new StripeBillingAdapter(options);
    case BillingProviderType.MOCK:
    case "MOCK":
      return new MockBillingAdapter();
    default:
      throw new Error(`Unsupported or unrecognized billing provider: '${String(provider)}'`);
  }
}

