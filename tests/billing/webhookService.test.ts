import "dotenv/config";
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
import { POST as webhookRoute } from "@/app/api/billing/webhooks/[provider]/route";

describe("Phase 1.15.8 — Webhook Ingestion & Idempotency Integration Tests", () => {
  let prisma: PrismaClient;
  const runId = `wh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_wh_${runId}`;
  const planCode = `plan_wh_${runId}`;
  const subId = `sub_wh_${runId}`;
  const providerSubId = `sub_mock_${runId}`;
  const providerCustId = `cus_mock_${runId}`;

  let planId: string;
  let accountId: string;

  beforeAll(async () => {
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
        name: `Webhook Test Workspace ${runId}`,
        slug: `wh-ws-${runId}`,
      },
    });

    // 2. Create Billing Account
    const account = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsId,
        billingEmail: `billing-${runId}@example.com`,
        provider: "MOCK",
        providerCustomerId: providerCustId,
      },
    });
    accountId = account.id;

    // 3. Create Subscription Plan
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code: planCode,
        name: `Webhook Plan ${runId}`,
        tier: "STARTER",
        baseSeats: 1,
      },
    });
    planId = plan.id;

    // 4. Create Active Subscription
    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId: wsId,
        accountId,
        planId,
        status: SubscriptionStatus.ACTIVE,
        providerSubscriptionId: providerSubId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        seatsCount: 1,
      },
    });
  });

  afterAll(async () => {
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
          where: { workspaceId: wsId },
        });
        await prisma.subscriptionPlan.deleteMany({
          where: { id: planId },
        });
        await prisma.platformBillingAccount.deleteMany({
          where: { workspaceId: wsId },
        });
        await prisma.workspace.deleteMany({
          where: { id: wsId },
        });
      } catch (err) {
        console.error("Cleanup error in webhookService.test.ts:", err);
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  it("1. should enforce event-level idempotency when receiving duplicate deliveries of the same eventId", async () => {
    const eventId = `evt_dedup_${runId}`;
    const payload = {
      id: eventId,
      eventType: "customer.subscription.updated",
      provider: BillingProviderType.MOCK,
      data: {
        id: providerSubId,
        customer: providerCustId,
        status: "active",
        cancel_at_period_end: true,
      },
      rawEvent: { id: eventId, created: Math.floor(Date.now() / 1000) },
    };

    // First delivery — should process
    const result1 = await processBillingWebhookEvent(prisma, payload);
    expect(result1.received).toBe(true);
    expect(result1.deduplicated).toBe(false);
    expect(result1.processed).toBe(true);

    const inboxEntry1 = await prisma.billingWebhookEvent.findUnique({
      where: { providerEventId: eventId },
    });
    expect(inboxEntry1).toBeDefined();
    expect(inboxEntry1?.status).toBe(WebhookProcessingStatus.PROCESSED);

    // Second delivery (duplicate replay) — should deduplicate without double processing
    const result2 = await processBillingWebhookEvent(prisma, payload);
    expect(result2.received).toBe(true);
    expect(result2.deduplicated).toBe(true);
    expect(result2.processed).toBe(false);

    // Verify inbox record remains unchanged
    const inboxEntry2 = await prisma.billingWebhookEvent.findUnique({
      where: { providerEventId: eventId },
    });
    expect(inboxEntry2?.status).toBe(WebhookProcessingStatus.PROCESSED);
  });

  it("2. should transition PAST_DUE -> ACTIVE and record invoice/payment on invoice.payment_succeeded", async () => {
    // Put subscription into PAST_DUE
    await prisma.subscription.update({
      where: { id: subId },
      data: {
        status: SubscriptionStatus.PAST_DUE,
        dunningAttemptsCount: 2,
        gracePeriodEndsAt: new Date(Date.now() + 5 * 86400000),
      },
    });

    const eventId = `evt_pay_succ_${runId}`;
    const invoiceId = `in_succ_${runId}`;
    const paymentId = `pi_succ_${runId}`;

    const payload = {
      id: eventId,
      eventType: "invoice.payment_succeeded",
      provider: BillingProviderType.MOCK,
      data: {
        id: invoiceId,
        subscription: providerSubId,
        customer: providerCustId,
        amount_due: 4900,
        amount_paid: 4900,
        currency: "usd",
        payment_intent: paymentId,
        hosted_invoice_url: `https://mock-billing.aforden.internal/invoices/${invoiceId}`,
        invoice_pdf: `https://mock-billing.aforden.internal/invoices/${invoiceId}/pdf`,
      },
      rawEvent: { id: eventId, created: Math.floor(Date.now() / 1000) },
    };

    const result = await processBillingWebhookEvent(prisma, payload);
    expect(result.processed).toBe(true);

    // Verify subscription recovered to ACTIVE
    const sub = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(sub?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(sub?.dunningAttemptsCount).toBe(0);
    expect(sub?.gracePeriodEndsAt).toBeNull();

    // Verify SubscriptionInvoice
    const invoice = await prisma.subscriptionInvoice.findUnique({
      where: { providerInvoiceId: invoiceId },
    });
    expect(invoice).toBeDefined();
    expect(invoice?.status).toBe(SubscriptionInvoiceStatus.PAID);
    expect(invoice?.amountPaidCents).toBe(4900);

    // Verify SubscriptionPayment
    const payment = await prisma.subscriptionPayment.findUnique({
      where: { providerPaymentId: paymentId },
    });
    expect(payment).toBeDefined();
    expect(payment?.status).toBe(SubscriptionPaymentStatus.SUCCEEDED);
  });

  it("3. should transition ACTIVE -> PAST_DUE and set 7-day grace period on invoice.payment_failed", async () => {
    // Ensure subscription is ACTIVE
    await prisma.subscription.update({
      where: { id: subId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        dunningAttemptsCount: 0,
        gracePeriodEndsAt: null,
      },
    });

    const eventId = `evt_pay_fail_${runId}`;
    const invoiceId = `in_fail_${runId}`;
    const paymentId = `pi_fail_${runId}`;

    const payload = {
      id: eventId,
      eventType: "invoice.payment_failed",
      provider: BillingProviderType.MOCK,
      data: {
        id: invoiceId,
        subscription: providerSubId,
        customer: providerCustId,
        amount_due: 4900,
        currency: "usd",
        payment_intent: paymentId,
        last_payment_error: { message: "Card declined by issuing bank" },
      },
      rawEvent: { id: eventId, created: Math.floor(Date.now() / 1000) },
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
      where: { providerInvoiceId: invoiceId },
    });
    expect(invoice?.status).toBe(SubscriptionInvoiceStatus.OPEN);

    // Verify SubscriptionPayment is FAILED
    const payment = await prisma.subscriptionPayment.findUnique({
      where: { providerPaymentId: paymentId },
    });
    expect(payment?.status).toBe(SubscriptionPaymentStatus.FAILED);
    expect(payment?.failureReason).toContain("declined");
  });

  it("4. should transition subscription to CANCELED on customer.subscription.deleted", async () => {
    const eventId = `evt_sub_del_${runId}`;
    const payload = {
      id: eventId,
      eventType: "customer.subscription.deleted",
      provider: BillingProviderType.MOCK,
      data: {
        id: providerSubId,
        customer: providerCustId,
        status: "canceled",
      },
      rawEvent: { id: eventId, created: Math.floor(Date.now() / 1000) },
    };

    const result = await processBillingWebhookEvent(prisma, payload);
    expect(result.processed).toBe(true);

    const sub = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(sub?.status).toBe(SubscriptionStatus.CANCELED);
    expect(sub?.endedAt).toBeDefined();
  });

  it("5. should acknowledge unhandled valid event types as IGNORED without error", async () => {
    const eventId = `evt_unhandled_${runId}`;
    const payload = {
      id: eventId,
      eventType: "payment_intent.created",
      provider: BillingProviderType.MOCK,
      data: { id: `pi_test_${runId}` },
      rawEvent: { id: eventId, created: Math.floor(Date.now() / 1000) },
    };

    const result = await processBillingWebhookEvent(prisma, payload);
    expect(result.received).toBe(true);
    expect(result.processed).toBe(false);

    const inbox = await prisma.billingWebhookEvent.findUnique({
      where: { providerEventId: eventId },
    });
    expect(inbox?.status).toBe(WebhookProcessingStatus.IGNORED);
  });

  it("6. should reject invalid signature in REST route handler without saving to database", async () => {
    const paramsPromise = Promise.resolve({ provider: "stripe" });
    const req = new Request("http://localhost/api/billing/webhooks/stripe", {
      method: "POST",
      headers: {
        "stripe-signature": "t=123,v1=invalid_hmac_signature",
      },
      body: JSON.stringify({
        id: `evt_invalid_sig_${runId}`,
        type: "invoice.payment_succeeded",
      }),
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.success).toBe(false);

    // Verify nothing written to DB
    const count = await prisma.billingWebhookEvent.count({
      where: { providerEventId: `evt_invalid_sig_${runId}` },
    });
    expect(count).toBe(0);
  });

  it("7. should successfully process valid mock webhook via REST route handler", async () => {
    const routeWsId = `ws_route_${runId}`;
    const routeSubId = `sub_route_${runId}`;
    const routeProviderSubId = `sub_mock_route_${runId}`;
    const routeProviderCustId = `cus_mock_route_${runId}`;

    await prisma.workspace.create({
      data: {
        id: routeWsId,
        name: `Webhook Route WS ${runId}`,
        slug: `wh-route-${runId}`,
      },
    });

    const routeAccount = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: routeWsId,
        billingEmail: `route-${runId}@example.com`,
        provider: "MOCK",
        providerCustomerId: routeProviderCustId,
      },
    });

    await prisma.subscription.create({
      data: {
        id: routeSubId,
        workspaceId: routeWsId,
        accountId: routeAccount.id,
        planId,
        status: SubscriptionStatus.ACTIVE,
        providerSubscriptionId: routeProviderSubId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        seatsCount: 1,
      },
    });

    const eventId = `evt_route_mock_${runId}`;
    const paramsPromise = Promise.resolve({ provider: "mock" });

    const req = new Request("http://localhost/api/billing/webhooks/mock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: eventId,
        type: "customer.subscription.updated",
        data: {
          id: routeProviderSubId,
          customer: routeProviderCustId,
          status: "active",
        },
      }),
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.eventId).toBe(eventId);

    // Clean up
    await prisma.subscription.deleteMany({ where: { workspaceId: routeWsId } });
    await prisma.platformBillingAccount.deleteMany({ where: { workspaceId: routeWsId } });
    await prisma.workspace.deleteMany({ where: { id: routeWsId } });
  });
});

