import "dotenv/config";
import crypto from "crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import {
  BillingProviderType,
  SubscriptionStatus,
  SubscriptionInvoiceStatus,
  SubscriptionPaymentStatus,
  WebhookProcessingStatus,
} from "../../generated/prisma/enums";
import { processBillingWebhookEvent } from "@/lib/services/billing/webhookService";
import {
  mapPaddleEventToDomainAction,
  PADDLE_EVENT_NAMES,
} from "@/lib/services/billing/paddleWebhookMapper";
import { POST as webhookRoute } from "@/app/api/billing/webhooks/[provider]/route";

describe("Phase 1.23.2 — Paddle Webhook Ingestion Pipeline Integration Tests", () => {
  let prisma: PrismaClient;
  const runId = `pwh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_${runId}`;
  const planCode = `plan_${runId}`;
  const subId = `sub_${runId}`;
  const providerSubId = `sub_paddle_${runId}`;
  const providerCustId = `ctm_paddle_${runId}`;
  const webhookSecret = `paddlenotification_test_${runId}_sec123`;

  let planId: string;
  let accountId: string;
  let origEnvSecret: string | undefined;
  let origEnvApiKey: string | undefined;

  // Helper to compute Paddle-native signature header: ts=<seconds>;h1=<hmac_hex>
  function signPaddlePayload(rawBody: string, secret: string, timestampSeconds?: number): string {
    const ts = timestampSeconds ?? Math.floor(Date.now() / 1000);
    const signedPayload = `${ts}:${rawBody}`;
    const h1 = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
    return `ts=${ts};h1=${h1}`;
  }

  beforeAll(async () => {
    origEnvSecret = process.env.PADDLE_WEBHOOK_SECRET;
    origEnvApiKey = process.env.PADDLE_API_KEY;
    process.env.PADDLE_WEBHOOK_SECRET = webhookSecret;
    process.env.PADDLE_API_KEY = `paddlesecret_live_${runId}_api_key_123`;

    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Create Workspace
    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Paddle Webhook Test Workspace ${runId}`,
        slug: `paddle-wh-ws-${runId}`,
      },
    });

    // 2. Create Platform Billing Account for Paddle
    const account = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsId,
        billingEmail: `paddle-billing-${runId}@example.com`,
        provider: BillingProviderType.PADDLE,
        providerCustomerId: providerCustId,
      },
    });
    accountId = account.id;

    // 3. Create Subscription Plan
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code: planCode,
        name: `Paddle Plan ${runId}`,
        tier: "GROWTH",
        baseSeats: 5,
      },
    });
    planId = plan.id;

    // 4. Create Initial Subscription (INCOMPLETE, awaiting activation)
    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId: wsId,
        accountId,
        planId,
        status: SubscriptionStatus.INCOMPLETE,
        providerSubscriptionId: providerSubId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        seatsCount: 5,
      },
    });
  });

  afterAll(async () => {
    if (origEnvSecret !== undefined) {
      process.env.PADDLE_WEBHOOK_SECRET = origEnvSecret;
    } else {
      delete process.env.PADDLE_WEBHOOK_SECRET;
    }
    if (origEnvApiKey !== undefined) {
      process.env.PADDLE_API_KEY = origEnvApiKey;
    } else {
      delete process.env.PADDLE_API_KEY;
    }

    if (prisma) {
      try {
        await prisma.subscriptionPayment.deleteMany({
          where: { workspaceId: wsId },
        });
        await prisma.subscriptionInvoice.deleteMany({
          where: { workspaceId: wsId },
        });
        await prisma.subscriptionHistory.deleteMany({
          where: { subscriptionId: subId },
        });
        await prisma.billingWebhookEvent.deleteMany({
          where: { providerEventId: { contains: runId } },
        });
        await prisma.subscription.deleteMany({
          where: { OR: [{ workspaceId: wsId }, { planId }] },
        });
        if (planId) {
          await prisma.subscriptionPlan.deleteMany({
            where: { id: planId },
          });
        }
        await prisma.platformBillingAccount.deleteMany({
          where: { workspaceId: wsId },
        });
        await prisma.workspace.deleteMany({
          where: { id: wsId },
        });
      } catch (err) {
        console.error("Cleanup error in paddleWebhookPipeline.test.ts:", err);
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  // ===========================================================================
  // 1. Route-Level Dispatch & Webhook Verification
  // ===========================================================================
  describe("1. Route-Level Dispatch & Signature Verification (POST /api/billing/webhooks/paddle)", () => {
    it("should accept valid Paddle-Signature, verify HMAC, and process subscription.activated through the route handler", async () => {
      const eventId = `evt_paddle_route_${runId}`;
      const payloadObj = {
        event_id: eventId,
        event_type: "subscription.activated",
        occurred_at: new Date().toISOString(),
        data: {
          id: providerSubId,
          customer_id: providerCustId,
          address_id: `add_${runId}`,
          business_id: null,
          currency_code: "USD",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          status: "active",
          collection_mode: "automatic",
          billing_cycle: {
            interval: "month",
            frequency: 1,
          },
          current_billing_period: {
            starts_at: "2026-09-01T00:00:00.000Z",
            ends_at: "2026-10-01T00:00:00.000Z",
          },
          items: [
            {
              status: "active",
              quantity: 8,
              recurring: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              price: { id: "pri_growth_monthly" },
            },
          ],
          scheduled_change: null,
        },
      };

      const rawBody = JSON.stringify(payloadObj);
      const signature = signPaddlePayload(rawBody, webhookSecret);

      const paramsPromise = Promise.resolve({ provider: "paddle" });
      const req = new Request("http://localhost/api/billing/webhooks/paddle", {
        method: "POST",
        headers: {
          "paddle-signature": signature,
          "content-type": "application/json",
        },
        body: rawBody,
      });

      const res = await webhookRoute(req, { params: paramsPromise });
      expect(res.status).toBe(200);

      const json = await res.json();

      expect(json.received).toBe(true);
      expect(json.deduplicated).toBe(false);
      expect(json.processed).toBe(true);
      expect(json.eventId).toBe(eventId);

      // Verify subscription transitioned to ACTIVE in DB
      const sub = await prisma.subscription.findUnique({ where: { id: subId } });
      expect(sub?.status).toBe(SubscriptionStatus.ACTIVE);
      expect(sub?.seatsCount).toBe(8);

      // Verify BillingWebhookEvent inbox entry
      const inbox = await prisma.billingWebhookEvent.findUnique({
        where: { providerEventId: eventId },
      });
      expect(inbox?.status).toBe(WebhookProcessingStatus.PROCESSED);
    });

    it("should accept subscription.paused, verify HMAC, and transition subscription from ACTIVE to PAUSED in DB", async () => {
      // Ensure subscription is ACTIVE
      await prisma.subscription.update({
        where: { id: subId },
        data: { status: SubscriptionStatus.ACTIVE, lastSyncedProviderEventAt: null },
      });

      const eventId = `evt_paddle_paused_${runId}`;
      const payloadObj = {
        event_id: eventId,
        event_type: "subscription.paused",
        occurred_at: new Date().toISOString(),
        data: {
          id: providerSubId,
          customer_id: providerCustId,
          address_id: `add_${runId}`,
          business_id: null,
          currency_code: "USD",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          status: "paused",
          collection_mode: "automatic",
          billing_cycle: {
            interval: "month",
            frequency: 1,
          },
          current_billing_period: {
            starts_at: "2026-09-01T00:00:00.000Z",
            ends_at: "2026-10-01T00:00:00.000Z",
          },
          items: [
            {
              status: "active",
              quantity: 8,
              recurring: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              price: { id: "pri_growth_monthly" },
            },
          ],
          scheduled_change: null,
        },
      };

      const rawBody = JSON.stringify(payloadObj);
      const signature = signPaddlePayload(rawBody, webhookSecret);

      const paramsPromise = Promise.resolve({ provider: "paddle" });
      const req = new Request("http://localhost/api/billing/webhooks/paddle", {
        method: "POST",
        headers: {
          "paddle-signature": signature,
          "content-type": "application/json",
        },
        body: rawBody,
      });

      const res = await webhookRoute(req, { params: paramsPromise });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.received).toBe(true);
      expect(json.processed).toBe(true);

      // Verify DB mutation: Subscription status landed in PAUSED in the DB
      const sub = await prisma.subscription.findUnique({ where: { id: subId } });
      expect(sub?.status).toBe(SubscriptionStatus.PAUSED);

      // Restore subscription to ACTIVE for subsequent tests
      await prisma.subscription.update({
        where: { id: subId },
        data: { status: SubscriptionStatus.ACTIVE, lastSyncedProviderEventAt: null },
      });
    });
  });

  // ===========================================================================
  // 2. The 4 Malformed-Payload Adversarial Defense Cases
  // ===========================================================================
  describe("2. Malformed-Payload Adversarial Defense (4 Distinct Cases)", () => {
    const validBody = JSON.stringify({
      event_id: `evt_malform_${runId}`,
      event_type: "subscription.updated",
      occurred_at: new Date().toISOString(),
      data: { id: providerSubId, customer_id: providerCustId, status: "active" },
    });

    it("(a) rejects request when Paddle-Signature header is missing", async () => {
      const paramsPromise = Promise.resolve({ provider: "paddle" });
      const req = new Request("http://localhost/api/billing/webhooks/paddle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: validBody,
      });

      const res = await webhookRoute(req, { params: paramsPromise });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Invalid webhook signature or payload.");

      const count = await prisma.billingWebhookEvent.count({
        where: { providerEventId: `evt_malform_${runId}` },
      });
      expect(count).toBe(0);
    });

    it("(b) rejects request when payload body is corrupted / signature mismatch", async () => {
      const validSig = signPaddlePayload(validBody, webhookSecret);
      const corruptedBody = validBody.replace("active", "canceled");

      const paramsPromise = Promise.resolve({ provider: "paddle" });
      const req = new Request("http://localhost/api/billing/webhooks/paddle", {
        method: "POST",
        headers: {
          "paddle-signature": validSig,
          "content-type": "application/json",
        },
        body: corruptedBody,
      });

      const res = await webhookRoute(req, { params: paramsPromise });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Invalid webhook signature or payload.");
    });

    it("(c) rejects request signed with wrong / rotated secret", async () => {
      const wrongSecret = "paddlenotification_foreign_wrong_secret_123";
      const wrongSig = signPaddlePayload(validBody, wrongSecret);

      const paramsPromise = Promise.resolve({ provider: "paddle" });
      const req = new Request("http://localhost/api/billing/webhooks/paddle", {
        method: "POST",
        headers: {
          "paddle-signature": wrongSig,
          "content-type": "application/json",
        },
        body: validBody,
      });

      const res = await webhookRoute(req, { params: paramsPromise });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Invalid webhook signature or payload.");
    });

    it("(d) rejects replayed old event (timestamp drift > 5 seconds)", async () => {
      // Set timestamp 10 seconds in the past (> MAX_VALID_TIME_DIFFERENCE of 5s)
      const tenSecondsAgo = Math.floor(Date.now() / 1000) - 10;
      const replayedSig = signPaddlePayload(validBody, webhookSecret, tenSecondsAgo);

      const paramsPromise = Promise.resolve({ provider: "paddle" });
      const req = new Request("http://localhost/api/billing/webhooks/paddle", {
        method: "POST",
        headers: {
          "paddle-signature": replayedSig,
          "content-type": "application/json",
        },
        body: validBody,
      });

      const res = await webhookRoute(req, { params: paramsPromise });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Invalid webhook signature or payload.");
    });
  });

  // ===========================================================================
  // 3. Idempotency & Replay Protection
  // ===========================================================================
  describe("3. Idempotency & Replay Protection", () => {
    it("should process event once and return deduplicated: true with zero mutations on duplicate delivery", async () => {
      const eventId = `evt_paddle_dedup_${runId}`;
      const payload = {
        id: eventId,
        eventType: "subscription.updated",
        provider: BillingProviderType.PADDLE,
        data: {
          id: providerSubId,
          customer_id: providerCustId,
          status: "active",
          current_billing_period: {
            starts_at: "2026-09-01T00:00:00.000Z",
            ends_at: "2026-10-01T00:00:00.000Z",
          },
          items: [{ quantity: 10, price: { id: "pri_growth" } }],
          scheduled_change: null,
        },
        rawEvent: {
          eventId,
          eventType: "subscription.updated",
          occurredAt: "2026-09-04T12:00:00.000Z",
        },
      };

      // Delivery 1 — processes
      const result1 = await processBillingWebhookEvent(prisma, payload);
      expect(result1.received).toBe(true);
      expect(result1.deduplicated).toBe(false);
      expect(result1.processed).toBe(true);

      const subAfter1 = await prisma.subscription.findUnique({ where: { id: subId } });
      expect(subAfter1?.seatsCount).toBe(10);

      // Delivery 2 (duplicate replay) — deduplicates
      const result2 = await processBillingWebhookEvent(prisma, payload);
      expect(result2.received).toBe(true);
      expect(result2.deduplicated).toBe(true);
      expect(result2.processed).toBe(false);

      // Verify inbox status remains PROCESSED
      const inbox = await prisma.billingWebhookEvent.findUnique({
        where: { providerEventId: eventId },
      });
      expect(inbox?.status).toBe(WebhookProcessingStatus.PROCESSED);
    });

    it("should ignore out-of-order event with older occurredAt timestamp without reverting newer subscription state", async () => {
      const newerTimestamp = new Date(Date.now() - 60000); // 1 minute ago
      const olderTimestamp = new Date(Date.now() - 3600000); // 1 hour ago

      // Set subscription lastSyncedProviderEventAt to newer timestamp with 15 seats
      await prisma.subscription.update({
        where: { id: subId },
        data: {
          seatsCount: 15,
          lastSyncedProviderEventAt: newerTimestamp,
        },
      });

      // Stale event arrives out-of-order with 5 seats
      const staleEventId = `evt_stale_${runId}`;
      const stalePayload = {
        id: staleEventId,
        eventType: "subscription.updated",
        provider: BillingProviderType.PADDLE,
        data: {
          id: providerSubId,
          customer_id: providerCustId,
          status: "active",
          current_billing_period: {
            starts_at: "2026-09-01T00:00:00.000Z",
            ends_at: "2026-10-01T00:00:00.000Z",
          },
          items: [{ quantity: 5, price: { id: "pri_growth" } }],
        },
        rawEvent: {
          eventId: staleEventId,
          eventType: "subscription.updated",
          occurredAt: olderTimestamp.toISOString(),
        },
      };

      const result = await processBillingWebhookEvent(prisma, stalePayload);
      expect(result.processed).toBe(true);

      // Verify subscription seats were NOT reverted to 5
      const sub = await prisma.subscription.findUnique({ where: { id: subId } });
      expect(sub?.seatsCount).toBe(15);
      expect(sub?.lastSyncedProviderEventAt?.toISOString()).toBe(newerTimestamp.toISOString());

      // Reset lastSyncedProviderEventAt so subsequent tests are not blocked
      await prisma.subscription.update({
        where: { id: subId },
        data: { lastSyncedProviderEventAt: null },
      });
    });
  });

  // ===========================================================================
  // 4. Transaction Payment Succeeded & Failed Ingestion
  // ===========================================================================
  describe("4. Transaction Payment Succeeded & Failed (Invoice & Payment Ingestion)", () => {
    it("should recover PAST_DUE subscription to ACTIVE and upsert invoice & payment on transaction.completed", async () => {
      // Put subscription in PAST_DUE
      await prisma.subscription.update({
        where: { id: subId },
        data: {
          status: SubscriptionStatus.PAST_DUE,
          dunningAttemptsCount: 1,
          gracePeriodEndsAt: new Date(Date.now() + 5 * 86400000),
        },
      });

      const eventId = `evt_txn_comp_${runId}`;
      const txnId = `txn_succ_${runId}`;
      const invoiceNumber = `inv_num_${runId}`;
      const paymentId = `pmt_succ_${runId}`;

      const payload = {
        id: eventId,
        eventType: "transaction.completed",
        provider: BillingProviderType.PADDLE,
        data: {
          id: txnId,
          subscription_id: providerSubId,
          customer_id: providerCustId,
          invoice_number: invoiceNumber,
          currency_code: "USD",
          billed_at: new Date().toISOString(),
          details: {
            totals: {
              total: 4900,
              subtotal: 4500,
              tax: 400,
            },
          },
          payments: [
            {
              id: paymentId,
              status: "captured",
              amount: 4900,
            },
          ],
          checkout: {
            url: `https://checkout.paddle.com/invoices/${invoiceNumber}`,
          },
        },
        rawEvent: {
          eventId,
          eventType: "transaction.completed",
          occurredAt: new Date().toISOString(),
        },
      };

      const result = await processBillingWebhookEvent(prisma, payload);
      expect(result.processed).toBe(true);

      // Verify subscription recovered to ACTIVE
      const sub = await prisma.subscription.findUnique({ where: { id: subId } });
      expect(sub?.status).toBe(SubscriptionStatus.ACTIVE);
      expect(sub?.dunningAttemptsCount).toBe(0);
      expect(sub?.gracePeriodEndsAt).toBeNull();

      // Verify SubscriptionInvoice created as PAID
      const invoice = await prisma.subscriptionInvoice.findUnique({
        where: { providerInvoiceId: invoiceNumber },
      });
      expect(invoice).toBeDefined();
      expect(invoice?.status).toBe(SubscriptionInvoiceStatus.PAID);
      expect(invoice?.amountDueCents).toBe(4900);
      expect(invoice?.amountPaidCents).toBe(4900);
      expect(invoice?.currency).toBe("USD");

      // Verify SubscriptionPayment created as SUCCEEDED
      const payment = await prisma.subscriptionPayment.findUnique({
        where: { providerPaymentId: paymentId },
      });
      expect(payment).toBeDefined();
      expect(payment?.status).toBe(SubscriptionPaymentStatus.SUCCEEDED);
      expect(payment?.amountCents).toBe(4900);
    });

    it("should transition ACTIVE subscription to PAST_DUE and record failed invoice/payment on transaction.payment_failed", async () => {
      // Ensure subscription is ACTIVE
      await prisma.subscription.update({
        where: { id: subId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          dunningAttemptsCount: 0,
          gracePeriodEndsAt: null,
        },
      });

      const eventId = `evt_txn_fail_${runId}`;
      const txnId = `txn_fail_${runId}`;
      const invoiceNumber = `inv_fail_num_${runId}`;
      const paymentId = `pmt_fail_${runId}`;

      const payload = {
        id: eventId,
        eventType: "transaction.payment_failed",
        provider: BillingProviderType.PADDLE,
        data: {
          id: txnId,
          subscription_id: providerSubId,
          customer_id: providerCustId,
          invoice_number: invoiceNumber,
          currency_code: "USD",
          details: {
            totals: {
              total: 4900,
              subtotal: 4500,
              tax: 400,
            },
          },
          payments: [
            {
              id: paymentId,
              status: "error",
              error_response: {
                description: "Insufficient funds in customer card account",
              },
            },
          ],
        },
        rawEvent: {
          eventId,
          eventType: "transaction.payment_failed",
          occurredAt: new Date().toISOString(),
        },
      };

      const result = await processBillingWebhookEvent(prisma, payload);
      expect(result.processed).toBe(true);

      // Verify subscription transitioned to PAST_DUE
      const sub = await prisma.subscription.findUnique({ where: { id: subId } });
      expect(sub?.status).toBe(SubscriptionStatus.PAST_DUE);
      expect(sub?.dunningAttemptsCount).toBe(1);
      expect(sub?.gracePeriodEndsAt).toBeDefined();

      // Verify SubscriptionInvoice is OPEN
      const invoice = await prisma.subscriptionInvoice.findUnique({
        where: { providerInvoiceId: invoiceNumber },
      });
      expect(invoice?.status).toBe(SubscriptionInvoiceStatus.OPEN);

      // Verify SubscriptionPayment is FAILED
      const payment = await prisma.subscriptionPayment.findUnique({
        where: { providerPaymentId: paymentId },
      });
      expect(payment?.status).toBe(SubscriptionPaymentStatus.FAILED);
      expect(payment?.failureReason).toContain("Insufficient funds");
    });
  });

  // ===========================================================================
  // 5. Subscription Cancellation Lifecycle
  // ===========================================================================
  describe("5. Subscription Cancellation Lifecycle", () => {
    it("should transition subscription to CANCELED and record endedAt on subscription.canceled", async () => {
      const eventId = `evt_paddle_cancel_${runId}`;
      const canceledAt = new Date().toISOString();

      const payload = {
        id: eventId,
        eventType: "subscription.canceled",
        provider: BillingProviderType.PADDLE,
        data: {
          id: providerSubId,
          customer_id: providerCustId,
          status: "canceled",
          canceled_at: canceledAt,
        },
        rawEvent: {
          eventId,
          eventType: "subscription.canceled",
          occurredAt: canceledAt,
        },
      };

      const result = await processBillingWebhookEvent(prisma, payload);
      expect(result.processed).toBe(true);

      const sub = await prisma.subscription.findUnique({ where: { id: subId } });
      expect(sub?.status).toBe(SubscriptionStatus.CANCELED);
      expect(sub?.endedAt).toBeDefined();
    });
  });

  // ===========================================================================
  // 6. Exhaustive Event Taxonomy & Error Handling
  // ===========================================================================
  describe("6. Exhaustive Event Taxonomy & Error Handling", () => {
    it("should explicitly map every official Paddle event name in the taxonomy without silent fallthrough", () => {
      for (const eventName of PADDLE_EVENT_NAMES) {
        const dummyPayload = {
          id: "evt_test",
          eventType: eventName,
          provider: BillingProviderType.PADDLE,
          data: {
            id: "sub_dummy",
            status: "active",
            subscriptionId: "sub_dummy",
          },
          rawEvent: {},
        };

        const action = mapPaddleEventToDomainAction(dummyPayload);
        expect(action).toBeDefined();
        expect(["SUBSCRIPTION_SYNC", "SUBSCRIPTION_CANCELED", "PAYMENT_SUCCEEDED", "PAYMENT_FAILED", "IGNORED"]).toContain(
          action.type
        );
      }
    });

    it("should throw explicitly on unrecognized event types with zero silent fallthrough", () => {
      const invalidEvent = {
        id: "evt_invalid",
        eventType: "unrecognized.paddle.event.name",
        provider: BillingProviderType.PADDLE,
        data: {},
        rawEvent: {},
      };

      expect(() => mapPaddleEventToDomainAction(invalidEvent as any)).toThrow(
        "Unrecognized Paddle event type: 'unrecognized.paddle.event.name'"
      );
    });

    it("should acknowledge non-mutating events (e.g. price.created) as IGNORED without database mutation", async () => {
      const eventId = `evt_price_created_${runId}`;
      const payload = {
        id: eventId,
        eventType: "price.created",
        provider: BillingProviderType.PADDLE,
        data: {
          id: "pri_test_catalog",
          product_id: "pro_test_123",
        },
        rawEvent: {
          eventId,
          eventType: "price.created",
          occurredAt: new Date().toISOString(),
        },
      };

      const result = await processBillingWebhookEvent(prisma, payload);
      expect(result.received).toBe(true);
      expect(result.processed).toBe(false);

      const inbox = await prisma.billingWebhookEvent.findUnique({
        where: { providerEventId: eventId },
      });
      expect(inbox?.status).toBe(WebhookProcessingStatus.IGNORED);
    });
  });
});
