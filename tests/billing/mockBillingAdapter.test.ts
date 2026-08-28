import { describe, expect, it, beforeEach } from "vitest";
import { MockBillingAdapter } from "@/lib/services/billing/providers/mockBillingAdapter";
import { SubscriptionStatus, BillingProviderType } from "@/generated/prisma/enums";
import { WebhookVerificationError } from "@/lib/services/billing/billingErrors";

describe("Phase 1.15.3 — MockBillingAdapter Tests", () => {
  let adapter: MockBillingAdapter;

  beforeEach(() => {
    adapter = new MockBillingAdapter();
  });

  describe("1. Customer Management", () => {
    it("should create a customer with deterministic mock ID and valid payment method metadata", async () => {
      const result = await adapter.createCustomer({
        workspaceId: "ws_123",
        email: "test@example.com",
        name: "Acme HVAC Corp",
      });

      expect(result.providerCustomerId).toMatch(/^cus_mock_/);
      expect(result.email).toBe("test@example.com");
      expect(result.name).toBe("Acme HVAC Corp");
      expect(result.paymentMethodBrand).toBe("visa");
      expect(result.paymentMethodLast4).toBe("4242");
      expect(result.paymentMethodExpMonth).toBe(12);
      expect(result.paymentMethodExpYear).toBe(2030);
    });

    it("should update an existing customer", async () => {
      const created = await adapter.createCustomer({
        workspaceId: "ws_123",
        email: "test@example.com",
      });

      const updated = await adapter.updateCustomer({
        providerCustomerId: created.providerCustomerId,
        name: "Acme Updated Name",
        email: "updated@example.com",
      });

      expect(updated.providerCustomerId).toBe(created.providerCustomerId);
      expect(updated.name).toBe("Acme Updated Name");
      expect(updated.email).toBe("updated@example.com");
    });

    it("should throw when updating a non-existent customer", async () => {
      await expect(
        adapter.updateCustomer({
          providerCustomerId: "cus_mock_nonexistent",
          name: "Test",
        })
      ).rejects.toThrow("Mock customer 'cus_mock_nonexistent' not found");
    });
  });

  describe("2. Checkout & Portal Sessions", () => {
    it("should create a mock checkout session with valid URL", async () => {
      const session = await adapter.createCheckoutSession({
        workspaceId: "ws_123",
        providerPriceId: "price_growth_monthly",
        quantity: 5,
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      });

      expect(session.sessionId).toMatch(/^cs_mock_/);
      expect(session.sessionUrl).toContain(session.sessionId);
    });

    it("should create a mock portal session with valid URL", async () => {
      const session = await adapter.createPortalSession({
        providerCustomerId: "cus_mock_123",
        returnUrl: "https://example.com/settings/billing",
      });

      expect(session.portalUrl).toContain("cus_mock_123");
    });
  });

  describe("3. Subscription Lifecycle", () => {
    it("should create an active subscription by default", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_growth_monthly",
        seatsCount: 3,
      });

      expect(sub.providerSubscriptionId).toMatch(/^sub_mock_/);
      expect(sub.providerCustomerId).toBe("cus_mock_123");
      expect(sub.status).toBe(SubscriptionStatus.ACTIVE);
      expect(sub.seatsCount).toBe(3);
      expect(sub.cancelAtPeriodEnd).toBe(false);
      expect(sub.currentPeriodStart).toBeInstanceOf(Date);
      expect(sub.currentPeriodEnd).toBeInstanceOf(Date);
      expect(sub.trialStart).toBeNull();
      expect(sub.trialEnd).toBeNull();
    });

    it("should create a trialing subscription when trialPeriodDays is provided", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_growth_monthly",
        seatsCount: 1,
        trialPeriodDays: 14,
      });

      expect(sub.status).toBe(SubscriptionStatus.TRIALING);
      expect(sub.trialStart).toBeInstanceOf(Date);
      expect(sub.trialEnd).toBeInstanceOf(Date);
      expect(sub.trialEnd!.getTime()).toBeGreaterThan(sub.trialStart!.getTime());
    });

    it("should update subscription seats and price", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_starter_monthly",
        seatsCount: 1,
      });

      const updated = await adapter.updateSubscription({
        providerSubscriptionId: sub.providerSubscriptionId,
        providerPriceId: "price_growth_monthly",
        seatsCount: 5,
      });

      expect(updated.seatsCount).toBe(5);

      const state = await adapter.fetchSubscription(sub.providerSubscriptionId);
      expect(state.seatsCount).toBe(5);
      expect(state.providerPriceId).toBe("price_growth_monthly");
    });

    it("should cancel subscription immediately when requested", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_growth_monthly",
      });

      const canceled = await adapter.cancelSubscription({
        providerSubscriptionId: sub.providerSubscriptionId,
        immediately: true,
      });

      expect(canceled.status).toBe(SubscriptionStatus.CANCELED);
      expect(canceled.canceledAt).toBeInstanceOf(Date);
      expect(canceled.endedAt).toBeInstanceOf(Date);
    });

    it("should cancel subscription at period end", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_growth_monthly",
      });

      const canceled = await adapter.cancelSubscription({
        providerSubscriptionId: sub.providerSubscriptionId,
        immediately: false,
      });

      expect(canceled.status).toBe(SubscriptionStatus.ACTIVE);
      expect(canceled.cancelAtPeriodEnd).toBe(true);
      expect(canceled.canceledAt).toBeInstanceOf(Date);
      expect(canceled.endedAt).toBeNull();
    });

    it("should resume a subscription scheduled for cancellation at period end", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_growth_monthly",
      });

      await adapter.cancelSubscription({
        providerSubscriptionId: sub.providerSubscriptionId,
        immediately: false,
      });

      const resumed = await adapter.resumeSubscription({
        providerSubscriptionId: sub.providerSubscriptionId,
      });

      expect(resumed.status).toBe(SubscriptionStatus.ACTIVE);
      expect(resumed.cancelAtPeriodEnd).toBe(false);
    });
  });

  describe("4. State Retrieval & Upcoming Invoices", () => {
    it("should fetch subscription state with payment method metadata", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_growth_monthly",
        seatsCount: 2,
      });

      const state = await adapter.fetchSubscription(sub.providerSubscriptionId);
      expect(state.providerSubscriptionId).toBe(sub.providerSubscriptionId);
      expect(state.paymentMethodBrand).toBe("visa");
      expect(state.paymentMethodLast4).toBe("4242");
    });

    it("should fetch upcoming invoice calculation for active subscription", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_growth_monthly",
        seatsCount: 2,
      });

      const invoice = await adapter.fetchUpcomingInvoice(sub.providerSubscriptionId);
      expect(invoice).not.toBeNull();
      expect(invoice!.amountDueCents).toBe(4900 * 2);
      expect(invoice!.currency).toBe("USD");
      expect(invoice!.periodStart).toBeInstanceOf(Date);
      expect(invoice!.periodEnd).toBeInstanceOf(Date);
    });

    it("should return null for upcoming invoice when subscription does not exist", async () => {
      const invoice = await adapter.fetchUpcomingInvoice("sub_mock_nonexistent");
      expect(invoice).toBeNull();
    });
  });

  describe("5. Webhook Verification & Simulation Helpers", () => {
    it("should verify and construct webhook event from valid JSON string", async () => {
      const rawPayload = JSON.stringify({
        id: "evt_mock_test123",
        type: "invoice.payment_succeeded",
        data: {
          object: {
            id: "in_mock_123",
            amount_paid: 4900,
          },
        },
      });

      const event = await adapter.verifyAndConstructWebhookEvent({
        rawBody: rawPayload,
        signature: "dummy_sig",
      });

      expect(event.id).toBe("evt_mock_test123");
      expect(event.eventType).toBe("invoice.payment_succeeded");
      expect(event.provider).toBe(BillingProviderType.MOCK);
      expect(event.data.id).toBe("in_mock_123");
    });

    it("should throw WebhookVerificationError on malformed JSON payload", async () => {
      await expect(
        adapter.verifyAndConstructWebhookEvent({
          rawBody: "invalid-json-string{",
          signature: "dummy_sig",
        })
      ).rejects.toThrowError(WebhookVerificationError);
    });

    it("should throw WebhookVerificationError when missing required type property", async () => {
      await expect(
        adapter.verifyAndConstructWebhookEvent({
          rawBody: JSON.stringify({ id: "evt_123" }),
          signature: "dummy_sig",
        })
      ).rejects.toThrowError(WebhookVerificationError);
    });

    it("simulatePaymentSuccess should produce a valid payment_succeeded payload", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_growth_monthly",
      });

      const event = adapter.simulatePaymentSuccess(sub.providerSubscriptionId, 14900);
      expect(event.eventType).toBe("invoice.payment_succeeded");
      expect(event.provider).toBe(BillingProviderType.MOCK);
      expect(event.data.amount_paid).toBe(14900);
      expect(event.data.subscription).toBe(sub.providerSubscriptionId);
    });

    it("simulatePaymentFailure should transition subscription to PAST_DUE and return event", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_growth_monthly",
      });

      const event = adapter.simulatePaymentFailure(sub.providerSubscriptionId, "card_declined");
      expect(event.eventType).toBe("invoice.payment_failed");
      expect((event.data.last_payment_error as any)?.message).toBe("card_declined");

      const state = await adapter.fetchSubscription(sub.providerSubscriptionId);
      expect(state.status).toBe(SubscriptionStatus.PAST_DUE);
    });

    it("simulateSubscriptionDeleted should set status to CANCELED and return event", async () => {
      const sub = await adapter.createSubscription({
        providerCustomerId: "cus_mock_123",
        providerPriceId: "price_growth_monthly",
      });

      const event = adapter.simulateSubscriptionDeleted(sub.providerSubscriptionId);
      expect(event.eventType).toBe("customer.subscription.deleted");

      const state = await adapter.fetchSubscription(sub.providerSubscriptionId);
      expect(state.status).toBe(SubscriptionStatus.CANCELED);
      expect(state.endedAt).toBeInstanceOf(Date);
    });
  });
});
