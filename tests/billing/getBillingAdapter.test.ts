import { describe, expect, it } from "vitest";
import { getBillingAdapter } from "@/lib/services/billing/providers/getBillingAdapter";
import { StripeBillingAdapter } from "@/lib/services/billing/providers/stripeBillingAdapter";
import { MockBillingAdapter } from "@/lib/services/billing/providers/mockBillingAdapter";
import { BillingProviderType } from "@/generated/prisma/enums";

describe("Phase 1.15.3 — getBillingAdapter Factory Tests", () => {
  it("should return a StripeBillingAdapter instance when provider is STRIPE and apiKey is provided", () => {
    const adapter = getBillingAdapter(BillingProviderType.STRIPE, { apiKey: "sk_test_mock123" });
    expect(adapter).toBeInstanceOf(StripeBillingAdapter);
    expect(adapter.providerName).toBe("STRIPE");
  });

  it("should throw configuration error if STRIPE is requested without apiKey or STRIPE_SECRET_KEY", () => {
    const prevKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;

    try {
      expect(() => getBillingAdapter(BillingProviderType.STRIPE)).toThrow(
        "Stripe API key is not configured. Please provide 'apiKey' or set 'STRIPE_SECRET_KEY' in the environment."
      );
    } finally {
      if (prevKey) process.env.STRIPE_SECRET_KEY = prevKey;
    }
  });

  it("should return a MockBillingAdapter instance when provider is MOCK", () => {
    const adapter = getBillingAdapter(BillingProviderType.MOCK);
    expect(adapter).toBeInstanceOf(MockBillingAdapter);
    expect(adapter.providerName).toBe("MOCK");
  });

  it("should throw on unrecognized provider without silent fallback", () => {
    expect(() => getBillingAdapter("BRAINTREE" as any)).toThrow(
      "Unsupported or unrecognized billing provider: 'BRAINTREE'"
    );
    expect(() => getBillingAdapter("" as any)).toThrow(
      "Unsupported or unrecognized billing provider: ''"
    );
    expect(() => getBillingAdapter(null as any)).toThrow(
      "Unsupported or unrecognized billing provider: 'null'"
    );
  });
});
