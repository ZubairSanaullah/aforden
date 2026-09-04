import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  PaddleBillingAdapter,
  translatePaddleSubscriptionStatus,
} from "@/lib/services/billing/providers";
import { SubscriptionStatus, BillingProviderType } from "@/generated/prisma/enums";
import { WebhookVerificationError } from "@/lib/services/billing/billingErrors";

describe("Phase 1.23.1 — PaddleBillingAdapter & Status Translation Tests", () => {
  describe("1. Constructor Credential & Environment Validation", () => {
    it("should throw configuration error immediately if apiKey and PADDLE_API_KEY are missing", () => {
      const prevKey = process.env.PADDLE_API_KEY;
      delete process.env.PADDLE_API_KEY;

      try {
        expect(() => new PaddleBillingAdapter()).toThrow(
          "Paddle API key is not configured. Please provide 'apiKey' or set 'PADDLE_API_KEY' in the environment."
        );
      } finally {
        if (prevKey) process.env.PADDLE_API_KEY = prevKey;
      }
    });

    it("should construct successfully when apiKey is provided", () => {
      const adapter = new PaddleBillingAdapter({ apiKey: "paddlesecret_test_123" });
      expect(adapter.providerName).toBe("PADDLE");
    });

    it("should default to sandbox environment when not specified", () => {
      const adapter = new PaddleBillingAdapter({ apiKey: "paddlesecret_test_123" });
      expect((adapter as any).environment).toBe("sandbox");
    });

    it("should honor production environment when specified", () => {
      const adapter = new PaddleBillingAdapter({
        apiKey: "paddlesecret_test_123",
        environment: "production",
      });
      expect((adapter as any).environment).toBe("production");
    });
  });

  describe("2. Paddle Status Mapping Function (Exhaustive & Explicit)", () => {
    it("should correctly translate all valid Paddle subscription statuses", () => {
      expect(translatePaddleSubscriptionStatus("active")).toBe(SubscriptionStatus.ACTIVE);
      expect(translatePaddleSubscriptionStatus("trialing")).toBe(SubscriptionStatus.TRIALING);
      expect(translatePaddleSubscriptionStatus("past_due")).toBe(SubscriptionStatus.PAST_DUE);
      expect(translatePaddleSubscriptionStatus("paused")).toBe(SubscriptionStatus.PAUSED);
      expect(translatePaddleSubscriptionStatus("canceled")).toBe(SubscriptionStatus.CANCELED);
    });

    it("should throw without silent fallthrough on unrecognized status strings", () => {
      expect(() => translatePaddleSubscriptionStatus("unknown_status")).toThrow(
        "Unrecognized Paddle subscription status: 'unknown_status'"
      );
      expect(() => translatePaddleSubscriptionStatus("")).toThrow(
        "Unrecognized Paddle subscription status: ''"
      );
      expect(() => translatePaddleSubscriptionStatus("incomplete")).toThrow(
        "Unrecognized Paddle subscription status: 'incomplete'"
      );
    });
  });

  describe("3. PaddleBillingAdapter Webhook Signature Verification", () => {
    it("should construct event when signature is valid", async () => {
      const adapter = new PaddleBillingAdapter({
        apiKey: "paddlesecret_mock123",
        webhookSecret: "paddlenotification_mock123",
      });

      const mockUnmarshal = vi.spyOn((adapter as any).paddle.webhooks, "unmarshal");
      mockUnmarshal.mockResolvedValue({
        eventId: "evt_paddle_123456",
        eventType: "subscription.activated",
        data: {
          id: "sub_paddle_123",
          status: "active",
        },
      } as any);

      const result = await adapter.verifyAndConstructWebhookEvent({
        rawBody: '{"event_id":"evt_paddle_123456"}',
        signature: "ts=123;h1=abcdef",
        secret: "paddlenotification_mock123",
      });

      expect(result.id).toBe("evt_paddle_123456");
      expect(result.eventType).toBe("subscription.activated");
      expect(result.provider).toBe(BillingProviderType.PADDLE);
      expect((result.data as any).id).toBe("sub_paddle_123");
    });

    it("should throw sanitized WebhookVerificationError without leaking raw exception trace", async () => {
      const adapter = new PaddleBillingAdapter({
        apiKey: "paddlesecret_mock123",
        webhookSecret: "paddlenotification_mock123",
      });

      const mockUnmarshal = vi.spyOn((adapter as any).paddle.webhooks, "unmarshal");
      mockUnmarshal.mockImplementation(() => {
        throw new Error("Sensitive internal Paddle verification trace at line 99");
      });

      try {
        await adapter.verifyAndConstructWebhookEvent({
          rawBody: '{"event_id":"evt_paddle_123456"}',
          signature: "invalid_sig",
          secret: "paddlenotification_mock123",
        });
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(WebhookVerificationError);
        expect(err.message).toBe("Webhook verification failed: Webhook signature verification failed");
        expect(err.message).not.toContain("Sensitive internal Paddle verification trace");
      }
    });

    it("should throw WebhookVerificationError when webhook secret is missing", async () => {
      const prevSecret = process.env.PADDLE_WEBHOOK_SECRET;
      delete process.env.PADDLE_WEBHOOK_SECRET;

      try {
        const adapter = new PaddleBillingAdapter({
          apiKey: "paddlesecret_mock123",
        });

        await expect(
          adapter.verifyAndConstructWebhookEvent({
            rawBody: '{"event_id":"evt_paddle_123"}',
            signature: "sig",
          })
        ).rejects.toThrowError(WebhookVerificationError);
      } finally {
        if (prevSecret) process.env.PADDLE_WEBHOOK_SECRET = prevSecret;
      }
    });
  });

  describe("4. Customer Management", () => {
    let adapter: PaddleBillingAdapter;

    beforeEach(() => {
      adapter = new PaddleBillingAdapter({
        apiKey: "paddlesecret_mock123",
        webhookSecret: "paddlenotification_mock123",
      });
    });

    it("should create customer with workspaceId in customData", async () => {
      const mockCreate = vi.spyOn((adapter as any).paddle.customers, "create");
      mockCreate.mockResolvedValue({
        id: "ctm_paddle_456",
        email: "tenant@example.com",
        name: "Acme Corp",
      } as any);

      const customer = await adapter.createCustomer({
        workspaceId: "ws_123",
        email: "tenant@example.com",
        name: "Acme Corp",
      });

      expect(mockCreate).toHaveBeenCalledWith({
        email: "tenant@example.com",
        name: "Acme Corp",
        customData: {
          workspaceId: "ws_123",
        },
      });
      expect(customer.providerCustomerId).toBe("ctm_paddle_456");
      expect(customer.email).toBe("tenant@example.com");
      expect(customer.name).toBe("Acme Corp");
    });

    it("should update customer name and metadata", async () => {
      const mockUpdate = vi.spyOn((adapter as any).paddle.customers, "update");
      mockUpdate.mockResolvedValue({
        id: "ctm_paddle_456",
        email: "newemail@example.com",
        name: "Acme International",
      } as any);

      const customer = await adapter.updateCustomer({
        providerCustomerId: "ctm_paddle_456",
        email: "newemail@example.com",
        name: "Acme International",
        metadata: { tier: "enterprise" },
      });

      expect(mockUpdate).toHaveBeenCalledWith("ctm_paddle_456", {
        email: "newemail@example.com",
        name: "Acme International",
        customData: { tier: "enterprise" },
      });
      expect(customer.providerCustomerId).toBe("ctm_paddle_456");
      expect(customer.email).toBe("newemail@example.com");
      expect(customer.name).toBe("Acme International");
    });
  });

  describe("5. Checkout & Customer Portal", () => {
    let adapter: PaddleBillingAdapter;

    beforeEach(() => {
      adapter = new PaddleBillingAdapter({
        apiKey: "paddlesecret_mock123",
        webhookSecret: "paddlenotification_mock123",
      });
    });

    it("should create checkout transaction, pass cancelUrl in customData, and return hosted checkout URL", async () => {
      const mockCreate = vi.spyOn((adapter as any).paddle.transactions, "create");
      mockCreate.mockResolvedValue({
        id: "txn_paddle_789",
        checkout: {
          url: "https://sandbox-checkout.paddle.com/checkout/txn_paddle_789",
        },
      } as any);

      const session = await adapter.createCheckoutSession({
        workspaceId: "ws_abc",
        providerPriceId: "pri_paddle_starter_monthly",
        quantity: 3,
        successUrl: "https://app.aforden.com/billing/success",
        cancelUrl: "https://app.aforden.com/billing/cancel",
        providerCustomerId: "ctm_paddle_456",
        metadata: { plan: "starter" },
      });

      expect(mockCreate).toHaveBeenCalledWith({
        items: [
          {
            priceId: "pri_paddle_starter_monthly",
            quantity: 3,
          },
        ],
        customerId: "ctm_paddle_456",
        customData: {
          workspaceId: "ws_abc",
          cancelUrl: "https://app.aforden.com/billing/cancel",
          plan: "starter",
        },
        collectionMode: "automatic",
        checkout: {
          url: "https://app.aforden.com/billing/success",
        },
      });
      expect(session.sessionId).toBe("txn_paddle_789");
      expect(session.sessionUrl).toBe("https://sandbox-checkout.paddle.com/checkout/txn_paddle_789");
    });

    it("should create customer portal session and return overview URL", async () => {
      const mockPortalCreate = vi.spyOn((adapter as any).paddle.customerPortalSessions, "create");
      mockPortalCreate.mockResolvedValue({
        id: "cpr_paddle_portal_123",
        customerId: "ctm_paddle_456",
        urls: {
          general: {
            overview: "https://customer-portal.paddle.com/cpr_paddle_portal_123",
          },
          subscriptions: [],
        },
      } as any);

      const portal = await adapter.createPortalSession({
        providerCustomerId: "ctm_paddle_456",
        returnUrl: "https://app.aforden.com/dashboard",
      });

      expect(mockPortalCreate).toHaveBeenCalledWith("ctm_paddle_456", []);
      expect(portal.portalUrl).toBe("https://customer-portal.paddle.com/cpr_paddle_portal_123");
    });

    it("should propagate raw SDK exception unwrapped when portal session creation fails", async () => {
      const mockPortalCreate = vi.spyOn((adapter as any).paddle.customerPortalSessions, "create");
      mockPortalCreate.mockRejectedValue(new Error("Paddle API Error: Customer not found"));

      await expect(
        adapter.createPortalSession({
          providerCustomerId: "ctm_nonexistent",
          returnUrl: "https://app.aforden.com/dashboard",
        })
      ).rejects.toThrow("Paddle API Error: Customer not found");
    });
  });

  describe("6. Subscription Lifecycle & Realistic Mapping", () => {
    let adapter: PaddleBillingAdapter;

    beforeEach(() => {
      adapter = new PaddleBillingAdapter({
        apiKey: "paddlesecret_mock123",
        webhookSecret: "paddlenotification_mock123",
      });
    });

    it("should map realistic Paddle Subscription fixture with dates, seats, and status", async () => {
      const periodStartsAt = "2026-09-01T00:00:00.000Z";
      const periodEndsAt = "2026-10-01T00:00:00.000Z";
      const trialStartsAt = "2026-08-18T00:00:00.000Z";
      const trialEndsAt = "2026-09-01T00:00:00.000Z";

      const realisticPaddleSubscription = {
        id: "sub_paddle_real_123",
        status: "active",
        customerId: "ctm_paddle_real_456",
        currentBillingPeriod: {
          startsAt: periodStartsAt,
          endsAt: periodEndsAt,
        },
        scheduledChange: null,
        canceledAt: null,
        startedAt: periodStartsAt,
        items: [
          {
            quantity: 8,
            price: {
              id: "pri_paddle_growth_monthly",
            },
            trialDates: {
              startsAt: trialStartsAt,
              endsAt: trialEndsAt,
            },
          },
        ],
        billingDetails: {
          paymentMethod: {
            card: {
              type: "visa",
              last4: "4242",
            },
          },
        },
      };

      const mockGet = vi.spyOn((adapter as any).paddle.subscriptions, "get");
      mockGet.mockResolvedValue(realisticPaddleSubscription as any);

      const mockPmList = vi.spyOn((adapter as any).paddle.paymentMethods, "list");
      mockPmList.mockReturnValue({
        next: vi.fn().mockResolvedValue([
          {
            card: {
              type: "visa",
              last4: "4242",
            },
          },
        ]),
      } as any);

      const state = await adapter.fetchSubscription("sub_paddle_real_123");

      expect(state.providerSubscriptionId).toBe("sub_paddle_real_123");
      expect(state.providerCustomerId).toBe("ctm_paddle_real_456");
      expect(state.status).toBe(SubscriptionStatus.ACTIVE);
      expect(state.seatsCount).toBe(8);
      expect(state.currentPeriodStart.toISOString()).toBe(periodStartsAt);
      expect(state.currentPeriodEnd.toISOString()).toBe(periodEndsAt);
      expect(state.trialStart?.toISOString()).toBe(trialStartsAt);
      expect(state.trialEnd?.toISOString()).toBe(trialEndsAt);
      expect(state.cancelAtPeriodEnd).toBe(false);
      expect(state.canceledAt).toBeNull();
      expect(state.endedAt).toBeNull();
      expect(state.providerPriceId).toBe("pri_paddle_growth_monthly");
      expect(state.paymentMethodBrand).toBe("visa");
      expect(state.paymentMethodLast4).toBe("4242");
    });

    it("should fetch and map verified active subscription when createSubscription transaction returns subscriptionId", async () => {
      const mockTxCreate = vi.spyOn((adapter as any).paddle.transactions, "create");
      mockTxCreate.mockResolvedValue({
        id: "txn_123",
        subscriptionId: "sub_paddle_sync_123",
      } as any);

      const mockSubGet = vi.spyOn((adapter as any).paddle.subscriptions, "get");
      mockSubGet.mockResolvedValue({
        id: "sub_paddle_sync_123",
        status: "active",
        customerId: "ctm_456",
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        items: [{ quantity: 5, price: { id: "pri_growth" } }],
      } as any);

      const result = await adapter.createSubscription({
        providerCustomerId: "ctm_456",
        providerPriceId: "pri_growth",
        seatsCount: 5,
      });

      expect(mockSubGet).toHaveBeenCalledWith("sub_paddle_sync_123");
      expect(result.providerSubscriptionId).toBe("sub_paddle_sync_123");
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
      expect(result.seatsCount).toBe(5);
    });

    it("should return explicit INCOMPLETE status without fabricating active state when createSubscription has no subscriptionId", async () => {
      const mockTxCreate = vi.spyOn((adapter as any).paddle.transactions, "create");
      const startsAtStr = "2026-09-04T10:00:00.000Z";
      const endsAtStr = "2026-10-04T10:00:00.000Z";
      mockTxCreate.mockResolvedValue({
        id: "txn_async_pending_123",
        subscriptionId: null, // asynchronous or awaiting customer payment
        status: "billed",
        billingPeriod: {
          startsAt: startsAtStr,
          endsAt: endsAtStr,
        },
      } as any);

      const mockSubGet = vi.spyOn((adapter as any).paddle.subscriptions, "get");

      const result = await adapter.createSubscription({
        providerCustomerId: "ctm_456",
        providerPriceId: "pri_growth",
        seatsCount: 3,
      });

      // Assert that subscriptions.get was NOT called with null
      expect(mockSubGet).not.toHaveBeenCalled();
      // Assert that status is strictly INCOMPLETE (never fabricated ACTIVE)
      expect(result.status).toBe(SubscriptionStatus.INCOMPLETE);
      expect(result.providerSubscriptionId).toBe("txn_async_pending_123");
      expect(result.providerCustomerId).toBe("ctm_456");
      expect(result.currentPeriodStart.toISOString()).toBe(startsAtStr);
      expect(result.currentPeriodEnd.toISOString()).toBe(endsAtStr);
      expect(result.seatsCount).toBe(3);
    });

    it("should query existing subscription for priceId when updateSubscription only specifies seatsCount (seats-only update)", async () => {
      const mockSubGet = vi.spyOn((adapter as any).paddle.subscriptions, "get");
      mockSubGet.mockResolvedValue({
        id: "sub_paddle_seats_only",
        status: "active",
        customerId: "ctm_456",
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        items: [{ quantity: 5, price: { id: "pri_existing_catalog_price" } }],
      } as any);

      const mockSubUpdate = vi.spyOn((adapter as any).paddle.subscriptions, "update");
      mockSubUpdate.mockResolvedValue({
        id: "sub_paddle_seats_only",
        status: "active",
        customerId: "ctm_456",
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        items: [{ quantity: 15, price: { id: "pri_existing_catalog_price" } }],
      } as any);

      const result = await adapter.updateSubscription({
        providerSubscriptionId: "sub_paddle_seats_only",
        seatsCount: 15, // No providerPriceId supplied!
      });

      expect(mockSubGet).toHaveBeenCalledWith("sub_paddle_seats_only");
      expect(mockSubUpdate).toHaveBeenCalledWith("sub_paddle_seats_only", {
        items: [
          {
            priceId: "pri_existing_catalog_price",
            quantity: 15,
          },
        ],
        prorationBillingMode: "prorated_immediately",
      });
      expect(result.seatsCount).toBe(15);
    });

    it("should update subscription with scheduled cancel when cancelAtPeriodEnd is true", async () => {
      const mockSubGet = vi.spyOn((adapter as any).paddle.subscriptions, "get");
      mockSubGet.mockResolvedValue({
        id: "sub_paddle_sched_cancel",
        status: "active",
        customerId: "ctm_456",
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        items: [{ quantity: 2, price: { id: "pri_starter" } }],
      } as any);

      const mockSubUpdate = vi.spyOn((adapter as any).paddle.subscriptions, "update");
      mockSubUpdate.mockResolvedValue({
        id: "sub_paddle_sched_cancel",
        status: "active",
        customerId: "ctm_456",
        scheduledChange: {
          action: "cancel",
          effectiveAt: "2026-10-01T00:00:00.000Z",
        },
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        items: [{ quantity: 2, price: { id: "pri_starter" } }],
      } as any);

      const result = await adapter.updateSubscription({
        providerSubscriptionId: "sub_paddle_sched_cancel",
        cancelAtPeriodEnd: true,
      });

      expect(mockSubUpdate).toHaveBeenCalledWith("sub_paddle_sched_cancel", {
        scheduledChange: {
          action: "cancel",
          effectiveAt: "2026-10-01T00:00:00.000Z",
        },
      });
      expect(result.cancelAtPeriodEnd).toBe(true);
    });

    it("should clear scheduled change when cancelAtPeriodEnd is false in updateSubscription", async () => {
      const mockSubUpdate = vi.spyOn((adapter as any).paddle.subscriptions, "update");
      mockSubUpdate.mockResolvedValue({
        id: "sub_paddle_unsched_cancel",
        status: "active",
        customerId: "ctm_456",
        scheduledChange: null,
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        items: [{ quantity: 2, price: { id: "pri_starter" } }],
      } as any);

      const result = await adapter.updateSubscription({
        providerSubscriptionId: "sub_paddle_unsched_cancel",
        cancelAtPeriodEnd: false,
      });

      expect(mockSubUpdate).toHaveBeenCalledWith("sub_paddle_unsched_cancel", {
        scheduledChange: null,
      });
      expect(result.cancelAtPeriodEnd).toBe(false);
    });

    it("should cancel subscription immediately when immediately flag is true", async () => {
      const mockCancel = vi.spyOn((adapter as any).paddle.subscriptions, "cancel");
      mockCancel.mockResolvedValue({
        id: "sub_paddle_cancel_1",
        status: "canceled",
        customerId: "ctm_456",
        canceledAt: "2026-09-04T12:00:00.000Z",
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        items: [{ quantity: 1, price: { id: "pri_1" } }],
      } as any);

      const result = await adapter.cancelSubscription({
        providerSubscriptionId: "sub_paddle_cancel_1",
        immediately: true,
      });

      expect(mockCancel).toHaveBeenCalledWith("sub_paddle_cancel_1", {
        effectiveFrom: "immediately",
      });
      expect(result.status).toBe(SubscriptionStatus.CANCELED);
      expect(result.canceledAt).not.toBeNull();
    });

    it("should cancel subscription at next_billing_period when immediately flag is false", async () => {
      const mockCancel = vi.spyOn((adapter as any).paddle.subscriptions, "cancel");
      mockCancel.mockResolvedValue({
        id: "sub_paddle_cancel_2",
        status: "active",
        customerId: "ctm_456",
        scheduledChange: { action: "cancel", effectiveAt: "2026-10-01T00:00:00.000Z" },
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        items: [{ quantity: 1, price: { id: "pri_1" } }],
      } as any);

      const result = await adapter.cancelSubscription({
        providerSubscriptionId: "sub_paddle_cancel_2",
        immediately: false,
      });

      expect(mockCancel).toHaveBeenCalledWith("sub_paddle_cancel_2", {
        effectiveFrom: "next_billing_period",
      });
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
      expect(result.cancelAtPeriodEnd).toBe(true);
    });

    it("should resume subscription immediately", async () => {
      const mockResume = vi.spyOn((adapter as any).paddle.subscriptions, "resume");
      mockResume.mockResolvedValue({
        id: "sub_paddle_resume_1",
        status: "active",
        customerId: "ctm_456",
        scheduledChange: null,
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        items: [{ quantity: 1, price: { id: "pri_1" } }],
      } as any);

      const result = await adapter.resumeSubscription({
        providerSubscriptionId: "sub_paddle_resume_1",
      });

      expect(mockResume).toHaveBeenCalledWith("sub_paddle_resume_1", {
        effectiveFrom: "immediately",
      });
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
      expect(result.cancelAtPeriodEnd).toBe(false);
    });

    it("should update subscription price and seats with prorated_immediately mode", async () => {
      const mockUpdate = vi.spyOn((adapter as any).paddle.subscriptions, "update");
      mockUpdate.mockResolvedValue({
        id: "sub_paddle_update_1",
        status: "active",
        customerId: "ctm_456",
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        items: [{ quantity: 12, price: { id: "pri_enterprise_monthly" } }],
      } as any);

      const result = await adapter.updateSubscription({
        providerSubscriptionId: "sub_paddle_update_1",
        providerPriceId: "pri_enterprise_monthly",
        seatsCount: 12,
      });

      expect(mockUpdate).toHaveBeenCalledWith("sub_paddle_update_1", {
        items: [
          {
            priceId: "pri_enterprise_monthly",
            quantity: 12,
          },
        ],
        prorationBillingMode: "prorated_immediately",
      });
      expect(result.seatsCount).toBe(12);
    });
  });

  describe("7. Upcoming Invoice Preview", () => {
    let adapter: PaddleBillingAdapter;

    beforeEach(() => {
      adapter = new PaddleBillingAdapter({
        apiKey: "paddlesecret_mock123",
        webhookSecret: "paddlenotification_mock123",
      });
    });

    it("should map recurringTransactionDetails into UpcomingInvoiceResult", async () => {
      const mockGet = vi.spyOn((adapter as any).paddle.subscriptions, "get");
      mockGet.mockResolvedValue({
        id: "sub_paddle_inv_1",
        currencyCode: "USD",
        nextBilledAt: "2026-10-01T00:00:00.000Z",
        currentBillingPeriod: {
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
        },
        recurringTransactionDetails: {
          totals: {
            total: "4900",
            subtotal: "4500",
            tax: "400",
          },
        },
      } as any);

      const invoice = await adapter.fetchUpcomingInvoice("sub_paddle_inv_1");

      expect(invoice).not.toBeNull();
      expect(invoice!.amountDueCents).toBe(4900);
      expect(invoice!.subtotalCents).toBe(4500);
      expect(invoice!.taxCents).toBe(400);
      expect(invoice!.currency).toBe("USD");
      expect(invoice!.periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(invoice!.periodEnd.toISOString()).toBe("2026-10-01T00:00:00.000Z");
      expect(invoice!.nextPaymentAttempt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    });

    it("should return null if recurringTransactionDetails is absent", async () => {
      const mockGet = vi.spyOn((adapter as any).paddle.subscriptions, "get");
      mockGet.mockResolvedValue({
        id: "sub_paddle_inv_2",
        recurringTransactionDetails: null,
      } as any);

      const invoice = await adapter.fetchUpcomingInvoice("sub_paddle_inv_2");
      expect(invoice).toBeNull();
    });
  });
});
