import { describe, expect, it, vi, beforeEach } from "vitest";
import Stripe from "stripe";
import {
  StripeBillingAdapter,
  translateStripeSubscriptionStatus,
} from "@/lib/services/billing/providers";
import { SubscriptionStatus, BillingProviderType } from "@/generated/prisma/enums";
import { WebhookVerificationError } from "@/lib/services/billing/billingErrors";

describe("Phase 1.15.3 — StripeBillingAdapter & Status Translation Tests", () => {
  describe("1. Constructor Credential Validation", () => {
    it("should throw configuration error immediately if apiKey and STRIPE_SECRET_KEY are missing", () => {
      const prevKey = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;

      try {
        expect(() => new StripeBillingAdapter()).toThrow(
          "Stripe API key is not configured. Please provide 'apiKey' or set 'STRIPE_SECRET_KEY' in the environment."
        );
      } finally {
        if (prevKey) process.env.STRIPE_SECRET_KEY = prevKey;
      }
    });

    it("should construct successfully when apiKey is provided", () => {
      const adapter = new StripeBillingAdapter({ apiKey: "sk_test_123" });
      expect(adapter.providerName).toBe("STRIPE");
    });
  });

  describe("2. Stripe Status Mapping Function (Exhaustive & Explicit)", () => {
    it("should correctly translate all valid Stripe subscription statuses", () => {
      expect(translateStripeSubscriptionStatus("trialing")).toBe(SubscriptionStatus.TRIALING);
      expect(translateStripeSubscriptionStatus("active")).toBe(SubscriptionStatus.ACTIVE);
      expect(translateStripeSubscriptionStatus("past_due")).toBe(SubscriptionStatus.PAST_DUE);
      expect(translateStripeSubscriptionStatus("unpaid")).toBe(SubscriptionStatus.UNPAID);
      expect(translateStripeSubscriptionStatus("canceled")).toBe(SubscriptionStatus.CANCELED);
      expect(translateStripeSubscriptionStatus("incomplete")).toBe(SubscriptionStatus.INCOMPLETE);
      expect(translateStripeSubscriptionStatus("incomplete_expired")).toBe(SubscriptionStatus.INCOMPLETE_EXPIRED);
      expect(translateStripeSubscriptionStatus("paused")).toBe(SubscriptionStatus.PAUSED);
    });

    it("should throw without silent fallthrough on unrecognized status strings", () => {
      expect(() => translateStripeSubscriptionStatus("unknown_status")).toThrow(
        "Unrecognized Stripe subscription status: 'unknown_status'"
      );
      expect(() => translateStripeSubscriptionStatus("")).toThrow(
        "Unrecognized Stripe subscription status: ''"
      );
      expect(() => translateStripeSubscriptionStatus("pending")).toThrow(
        "Unrecognized Stripe subscription status: 'pending'"
      );
    });
  });

  describe("3. StripeBillingAdapter Webhook Signature Verification", () => {
    it("should construct event when signature is valid", async () => {
      const adapter = new StripeBillingAdapter({
        apiKey: "sk_test_mock123",
        webhookSecret: "whsec_mock123",
      });

      const mockConstructEvent = vi.spyOn((adapter as any).stripe.webhooks, "constructEvent");
      mockConstructEvent.mockReturnValue({
        id: "evt_123456",
        type: "invoice.payment_succeeded",
        data: {
          object: {
            id: "in_123456",
            amount_paid: 4900,
          },
        },
      } as any);

      const result = await adapter.verifyAndConstructWebhookEvent({
        rawBody: '{"id":"evt_123456"}',
        signature: "t=123,v1=abcdef",
        secret: "whsec_mock123",
      });

      expect(result.id).toBe("evt_123456");
      expect(result.eventType).toBe("invoice.payment_succeeded");
      expect(result.provider).toBe(BillingProviderType.STRIPE);
      expect(result.data.id).toBe("in_123456");
    });

    it("should throw sanitized WebhookVerificationError without leaking raw Stripe exception text", async () => {
      const adapter = new StripeBillingAdapter({
        apiKey: "sk_test_mock123",
        webhookSecret: "whsec_mock123",
      });

      const mockConstructEvent = vi.spyOn((adapter as any).stripe.webhooks, "constructEvent");
      mockConstructEvent.mockImplementation(() => {
        throw new Error("Sensitive internal Stripe verification trace at line 42");
      });

      try {
        await adapter.verifyAndConstructWebhookEvent({
          rawBody: '{"id":"evt_123456"}',
          signature: "invalid_sig",
          secret: "whsec_mock123",
        });
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(WebhookVerificationError);
        expect(err.message).toBe("Webhook verification failed: Webhook signature verification failed");
        expect(err.message).not.toContain("Sensitive internal Stripe verification trace");
      }
    });

    it("should throw WebhookVerificationError when webhook secret is missing", async () => {
      const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_WEBHOOK_SECRET;

      try {
        const adapter = new StripeBillingAdapter({
          apiKey: "sk_test_mock123",
        });

        await expect(
          adapter.verifyAndConstructWebhookEvent({
            rawBody: '{"id":"evt_123456"}',
            signature: "sig",
          })
        ).rejects.toThrowError(WebhookVerificationError);
      } finally {
        if (prevSecret) process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
      }
    });
  });

  describe("4. Realistic Stripe SDK v22 Subscription Mapping", () => {
    let adapter: StripeBillingAdapter;

    beforeEach(() => {
      adapter = new StripeBillingAdapter({
        apiKey: "sk_test_mock_dummy",
        webhookSecret: "whsec_mock_dummy",
      });
    });

    it("should map realistic Stripe Subscription fixture with period dates on items.data[0]", async () => {
      const periodStartSeconds = 1700000000;
      const periodEndSeconds = 1702592000;
      const trialStartSeconds = 1699000000;
      const trialEndSeconds = 1700000000;

      // Realistic SDK v22 shape: current_period_start and current_period_end live on subscription items, not at top level
      const realisticStripeSubscription = {
        id: "sub_real_123",
        object: "subscription",
        customer: "cus_real_456",
        status: "active",
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        trial_start: trialStartSeconds,
        trial_end: trialEndSeconds,
        start_date: periodStartSeconds,
        created: periodStartSeconds,
        items: {
          object: "list",
          data: [
            {
              id: "si_item_789",
              object: "subscription_item",
              subscription: "sub_real_123",
              quantity: 5,
              current_period_start: periodStartSeconds,
              current_period_end: periodEndSeconds,
              price: {
                id: "price_growth_monthly",
                object: "price",
                unit_amount: 4900,
                currency: "usd",
              },
            },
          ],
          has_more: false,
          url: "/v1/subscription_items?subscription=sub_real_123",
        },
      };

      const mockRetrieve = vi.spyOn((adapter as any).stripe.subscriptions, "retrieve");
      mockRetrieve.mockResolvedValue(realisticStripeSubscription as any);

      const state = await adapter.fetchSubscription("sub_real_123");

      expect(state.providerSubscriptionId).toBe("sub_real_123");
      expect(state.providerCustomerId).toBe("cus_real_456");
      expect(state.status).toBe(SubscriptionStatus.ACTIVE);
      expect(state.seatsCount).toBe(5);
      expect(state.currentPeriodStart.getTime()).toBe(periodStartSeconds * 1000);
      expect(state.currentPeriodEnd.getTime()).toBe(periodEndSeconds * 1000);
      expect(state.trialStart?.getTime()).toBe(trialStartSeconds * 1000);
      expect(state.trialEnd?.getTime()).toBe(trialEndSeconds * 1000);
      expect(state.cancelAtPeriodEnd).toBe(false);
      expect(state.canceledAt).toBeNull();
      expect(state.endedAt).toBeNull();
      expect(state.providerPriceId).toBe("price_growth_monthly");
    });

    it("should handle canceled and ended dates correctly from Subscription object", async () => {
      const canceledAtSeconds = 1701000000;
      const endedAtSeconds = 1702592000;

      const canceledStripeSubscription = {
        id: "sub_canceled_123",
        object: "subscription",
        customer: "cus_real_456",
        status: "canceled",
        cancel_at_period_end: false,
        canceled_at: canceledAtSeconds,
        ended_at: endedAtSeconds,
        trial_start: null,
        trial_end: null,
        start_date: 1700000000,
        created: 1700000000,
        items: {
          object: "list",
          data: [
            {
              id: "si_1",
              quantity: 2,
              current_period_start: 1700000000,
              current_period_end: endedAtSeconds,
              price: { id: "price_standard" },
            },
          ],
          has_more: false,
        },
      };

      const mockCancel = vi.spyOn((adapter as any).stripe.subscriptions, "cancel");
      mockCancel.mockResolvedValue(canceledStripeSubscription as any);

      const result = await adapter.cancelSubscription({
        providerSubscriptionId: "sub_canceled_123",
        immediately: true,
      });

      expect(result.status).toBe(SubscriptionStatus.CANCELED);
      expect(result.canceledAt?.getTime()).toBe(canceledAtSeconds * 1000);
      expect(result.endedAt?.getTime()).toBe(endedAtSeconds * 1000);
    });

    it("should safely fall back to start_date/created when items list is empty", async () => {
      const startDateSeconds = 1700000000;
      const emptyItemsSubscription = {
        id: "sub_no_items",
        object: "subscription",
        customer: "cus_real_456",
        status: "active",
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        trial_start: null,
        trial_end: null,
        start_date: startDateSeconds,
        created: startDateSeconds,
        items: {
          object: "list",
          data: [],
          has_more: false,
        },
      };

      const mockRetrieve = vi.spyOn((adapter as any).stripe.subscriptions, "retrieve");
      mockRetrieve.mockResolvedValue(emptyItemsSubscription as any);

      const state = await adapter.fetchSubscription("sub_no_items");

      expect(state.currentPeriodStart.getTime()).toBe(startDateSeconds * 1000);
      expect(state.currentPeriodEnd.getTime()).toBe((startDateSeconds + 30 * 86400) * 1000);
      expect(state.seatsCount).toBe(1);
    });
  });

  describe("5. StripeBillingAdapter API Calls (Mocked SDK)", () => {
    let adapter: StripeBillingAdapter;

    beforeEach(() => {
      adapter = new StripeBillingAdapter({
        apiKey: "sk_test_mock_dummy",
        webhookSecret: "whsec_mock_dummy",
      });
    });

    it("should call stripe.customers.create and return mapped result without leaking sensitive data", async () => {
      const mockCreate = vi.spyOn((adapter as any).stripe.customers, "create");
      mockCreate.mockResolvedValue({
        id: "cus_stripe_123",
        email: "acme@example.com",
        name: "Acme Corp",
      } as any);

      const result = await adapter.createCustomer({
        workspaceId: "ws_123",
        email: "acme@example.com",
        name: "Acme Corp",
      });

      expect(result.providerCustomerId).toBe("cus_stripe_123");
      expect(result.email).toBe("acme@example.com");
      expect(result.name).toBe("Acme Corp");
      expect(result.paymentMethodBrand).toBeNull();
      expect(result.paymentMethodLast4).toBeNull();
    });

    it("should call stripe.checkout.sessions.create and return session URLs", async () => {
      const mockCreate = vi.spyOn((adapter as any).stripe.checkout.sessions, "create");
      mockCreate.mockResolvedValue({
        id: "cs_stripe_123",
        url: "https://checkout.stripe.com/c/pay/cs_stripe_123",
      } as any);

      const result = await adapter.createCheckoutSession({
        workspaceId: "ws_123",
        providerCustomerId: "cus_123",
        providerPriceId: "price_123",
        quantity: 3,
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      });

      expect(result.sessionId).toBe("cs_stripe_123");
      expect(result.sessionUrl).toBe("https://checkout.stripe.com/c/pay/cs_stripe_123");
    });

    it("should call stripe.billingPortal.sessions.create and return portal URL", async () => {
      const mockCreate = vi.spyOn((adapter as any).stripe.billingPortal.sessions, "create");
      mockCreate.mockResolvedValue({
        url: "https://billing.stripe.com/p/session/123",
      } as any);

      const result = await adapter.createPortalSession({
        providerCustomerId: "cus_123",
        returnUrl: "https://example.com/billing",
      });

      expect(result.portalUrl).toBe("https://billing.stripe.com/p/session/123");
    });

    it("should call stripe.subscriptions.create and map subscription fields", async () => {
      const mockCreate = vi.spyOn((adapter as any).stripe.subscriptions, "create");
      mockCreate.mockResolvedValue({
        id: "sub_stripe_123",
        customer: "cus_123",
        status: "active",
        items: {
          data: [
            {
              id: "si_1",
              quantity: 4,
              current_period_start: 1700000000,
              current_period_end: 1702592000,
            },
          ],
        },
        cancel_at_period_end: false,
      } as any);

      const result = await adapter.createSubscription({
        providerCustomerId: "cus_123",
        providerPriceId: "price_growth_monthly",
        seatsCount: 4,
      });

      expect(result.providerSubscriptionId).toBe("sub_stripe_123");
      expect(result.providerCustomerId).toBe("cus_123");
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
      expect(result.seatsCount).toBe(4);
      expect(result.cancelAtPeriodEnd).toBe(false);
      expect(result.currentPeriodStart.getTime()).toBe(1700000000 * 1000);
      expect(result.currentPeriodEnd.getTime()).toBe(1702592000 * 1000);
    });

    it("should retrieve subscription and expand payment method safely", async () => {
      const mockRetrieve = vi.spyOn((adapter as any).stripe.subscriptions, "retrieve");
      mockRetrieve.mockResolvedValue({
        id: "sub_stripe_123",
        customer: "cus_123",
        status: "active",
        items: {
          data: [
            {
              id: "si_1",
              price: { id: "price_growth" },
              quantity: 2,
              current_period_start: 1700000000,
              current_period_end: 1702592000,
            },
          ],
        },
        cancel_at_period_end: false,
        default_payment_method: {
          card: {
            brand: "mastercard",
            last4: "8888",
          },
        },
      } as any);

      const state = await adapter.fetchSubscription("sub_stripe_123");
      expect(state.providerSubscriptionId).toBe("sub_stripe_123");
      expect(state.providerPriceId).toBe("price_growth");
      expect(state.paymentMethodBrand).toBe("mastercard");
      expect(state.paymentMethodLast4).toBe("8888");
      expect(state.currentPeriodStart.getTime()).toBe(1700000000 * 1000);
      expect(state.currentPeriodEnd.getTime()).toBe(1702592000 * 1000);
    });

    it("should retrieve upcoming invoice preview using typed createPreview", async () => {
      const mockCreatePreview = vi.spyOn((adapter as any).stripe.invoices, "createPreview");
      mockCreatePreview.mockResolvedValue({
        amount_due: 9800,
        subtotal: 9800,
        currency: "usd",
        due_date: 1702592000,
        lines: {
          data: [
            {
              period: {
                start: 1700000000,
                end: 1702592000,
              },
            },
          ],
        },
      } as any);

      const preview = await adapter.fetchUpcomingInvoice("sub_stripe_123");
      expect(preview).not.toBeNull();
      expect(preview!.amountDueCents).toBe(9800);
      expect(preview!.currency).toBe("USD");
      expect(preview!.periodStart.getTime()).toBe(1700000000 * 1000);
      expect(preview!.periodEnd.getTime()).toBe(1702592000 * 1000);
      expect(mockCreatePreview).toHaveBeenCalledWith({ subscription: "sub_stripe_123" });
    });

    it("should wrap upcoming invoice errors cleanly without leaking raw Stripe exceptions", async () => {
      const mockCreatePreview = vi.spyOn((adapter as any).stripe.invoices, "createPreview");
      mockCreatePreview.mockRejectedValue(new Error("Raw Stripe internal database timeout"));

      await expect(adapter.fetchUpcomingInvoice("sub_stripe_123")).rejects.toThrow(
        "Failed to retrieve upcoming invoice from billing provider"
      );
    });
  });
});
