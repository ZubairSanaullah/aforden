/**
 * Phase 1.15.10 — SaaS Billing Reconciliation Service Integration Tests
 */

import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import {
  BillingProviderType,
  SubscriptionStatus,
} from "../../generated/prisma/enums";
import {
  reconcileSubscription,
  runReconciliationSweep,
} from "@/lib/services/billing/reconciliationService";
import { processBillingWebhookEvent } from "@/lib/services/billing/webhookService";
import { getBillingAdapter } from "@/lib/services/billing/providers/getBillingAdapter";
import { MockBillingAdapter } from "@/lib/services/billing/providers/mockBillingAdapter";
import { SubscriptionNotFoundError } from "@/lib/services/billing/billingErrors";

describe("Phase 1.15.10 — SaaS Billing Reconciliation Service Integration Tests", { timeout: 30000 }, () => {
  let prisma: PrismaClient;
  const runId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const planCode = `plan_rec_${runId}`;
  let planId: string;
  let mockAdapter: MockBillingAdapter;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    mockAdapter = getBillingAdapter("MOCK") as MockBillingAdapter;

    // Create Shared Subscription Plan
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code: planCode,
        name: `Reconciliation Plan ${runId}`,
        tier: "STARTER",
        baseSeats: 1,
      },
    });
    planId = plan.id;
  });

  afterAll(async () => {
    if (prisma) {
      try {
        await prisma.subscriptionPayment.deleteMany({
          where: { workspaceId: { contains: runId } },
        });
        await prisma.subscriptionInvoice.deleteMany({
          where: { workspaceId: { contains: runId } },
        });
        await prisma.subscriptionHistory.deleteMany({
          where: { subscription: { workspaceId: { contains: runId } } },
        });
        await prisma.billingWebhookEvent.deleteMany({
          where: { providerEventId: { contains: runId } },
        });
        await prisma.subscription.deleteMany({
          where: { workspaceId: { contains: runId } },
        });
        await prisma.subscriptionPlan.deleteMany({
          where: { id: planId },
        });
        await prisma.platformBillingAccount.deleteMany({
          where: { workspaceId: { contains: runId } },
        });
        await prisma.workspace.deleteMany({
          where: { id: { contains: runId } },
        });
      } catch (err) {
        console.error("Cleanup error in reconciliationService.test.ts:", err);
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  async function createWorkspaceAndAccount(suffix: string) {
    const ws = await prisma.workspace.create({
      data: {
        id: `ws_${runId}_${suffix}`,
        name: `Reconcile WS ${suffix} ${runId}`,
        slug: `rec-${suffix}-${runId}`,
      },
    });

    const account = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: ws.id,
        billingEmail: `billing-${suffix}-${runId}@example.com`,
        provider: "MOCK",
        providerCustomerId: `cus_${suffix}_${runId}`,
      },
    });

    return { workspaceId: ws.id, accountId: account.id };
  }

  it("1. should detect status drift and recover local PAST_DUE to ACTIVE when provider reports ACTIVE", async () => {
    const { workspaceId, accountId } = await createWorkspaceAndAccount("t1");
    const subId = `sub_rec_status_${runId}`;
    const psubId = `psub_rec_status_${runId}`;

    const now = new Date();
    const periodStart = new Date(now.getTime() - 10 * 86400000);
    const periodEnd = new Date(now.getTime() + 20 * 86400000);

    // Setup Local DB in PAST_DUE
    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId,
        accountId,
        planId,
        status: SubscriptionStatus.PAST_DUE,
        providerSubscriptionId: psubId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gracePeriodEndsAt: new Date(now.getTime() + 3 * 86400000),
        dunningAttemptsCount: 2,
        seatsCount: 2,
      },
    });

    // Setup Provider in ACTIVE (e.g. payment cleared externally)
    mockAdapter.setMockSubscription({
      providerSubscriptionId: psubId,
      providerCustomerId: `cus_t1_${runId}`,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialStart: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      seatsCount: 2,
    });

    const result = await reconcileSubscription(prisma, subId);

    expect(result.driftDetected).toBe(true);
    expect(result.driftTypes).toContain("STATUS_MISMATCH");
    expect(result.actionTaken).toBe("STATUS_TRANSITIONED");
    expect(result.previousState.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(result.correctedState.status).toBe(SubscriptionStatus.ACTIVE);

    // Verify DB updated
    const updated = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(updated?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(updated?.gracePeriodEndsAt).toBeNull();
    expect(updated?.dunningAttemptsCount).toBe(0);
  });

  it("2. should detect attribute drift (dates/seats) and sync without status change", async () => {
    const { workspaceId, accountId } = await createWorkspaceAndAccount("t2");
    const subId = `sub_rec_attr_${runId}`;
    const psubId = `psub_rec_attr_${runId}`;

    const oldStart = new Date(Date.now() - 40 * 86400000);
    const oldEnd = new Date(Date.now() - 10 * 86400000);
    const newStart = new Date(Date.now() - 10 * 86400000);
    const newEnd = new Date(Date.now() + 20 * 86400000);

    // Setup Local DB
    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId,
        accountId,
        planId,
        status: SubscriptionStatus.ACTIVE,
        providerSubscriptionId: psubId,
        currentPeriodStart: oldStart,
        currentPeriodEnd: oldEnd,
        seatsCount: 1,
        cancelAtPeriodEnd: false,
      },
    });

    // Setup Provider with renewed period dates and upgraded seats count
    mockAdapter.setMockSubscription({
      providerSubscriptionId: psubId,
      providerCustomerId: `cus_t2_${runId}`,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: newStart,
      currentPeriodEnd: newEnd,
      trialStart: null,
      trialEnd: null,
      cancelAtPeriodEnd: true,
      canceledAt: null,
      endedAt: null,
      seatsCount: 5,
    });

    const result = await reconcileSubscription(prisma, subId);

    expect(result.driftDetected).toBe(true);
    expect(result.driftTypes).toContain("PERIOD_MISMATCH");
    expect(result.driftTypes).toContain("SEATS_MISMATCH");
    expect(result.driftTypes).toContain("CANCEL_AT_PERIOD_END_MISMATCH");
    expect(result.actionTaken).toBe("ATTRIBUTES_SYNCED");

    // Verify DB updated
    const updated = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(updated?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(updated?.seatsCount).toBe(5);
    expect(updated?.cancelAtPeriodEnd).toBe(true);
    expect(updated?.currentPeriodStart.getTime()).toBe(newStart.getTime());
    expect(updated?.currentPeriodEnd.getTime()).toBe(newEnd.getTime());
  });

  it("3. should detect missed cancellation and transition local ACTIVE to CANCELED", async () => {
    const { workspaceId, accountId } = await createWorkspaceAndAccount("t3");
    const subId = `sub_rec_cancel_${runId}`;
    const psubId = `psub_rec_cancel_${runId}`;

    const now = new Date();
    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId,
        accountId,
        planId,
        status: SubscriptionStatus.ACTIVE,
        providerSubscriptionId: psubId,
        currentPeriodStart: new Date(now.getTime() - 15 * 86400000),
        currentPeriodEnd: new Date(now.getTime() + 15 * 86400000),
        seatsCount: 1,
      },
    });

    // Provider shows canceled
    mockAdapter.setMockSubscription({
      providerSubscriptionId: psubId,
      providerCustomerId: `cus_t3_${runId}`,
      status: SubscriptionStatus.CANCELED,
      currentPeriodStart: new Date(now.getTime() - 15 * 86400000),
      currentPeriodEnd: new Date(now.getTime() + 15 * 86400000),
      trialStart: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: now,
      endedAt: now,
      seatsCount: 1,
    });

    const result = await reconcileSubscription(prisma, subId);

    expect(result.driftDetected).toBe(true);
    expect(result.driftTypes).toContain("STATUS_MISMATCH");
    expect(result.actionTaken).toBe("STATUS_TRANSITIONED");
    expect(result.correctedState.status).toBe(SubscriptionStatus.CANCELED);

    const updated = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(updated?.status).toBe(SubscriptionStatus.CANCELED);
    expect(updated?.canceledAt).toBeDefined();
    expect(updated?.endedAt).toBeDefined();
  });

  it("4. should transition INCOMPLETE to INCOMPLETE_EXPIRED when provider marks expired", async () => {
    const { workspaceId, accountId } = await createWorkspaceAndAccount("t4");
    const subId = `sub_rec_incom_${runId}`;
    const psubId = `psub_rec_incom_${runId}`;

    const now = new Date();
    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId,
        accountId,
        planId,
        status: SubscriptionStatus.INCOMPLETE,
        providerSubscriptionId: psubId,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
        seatsCount: 1,
      },
    });

    mockAdapter.setMockSubscription({
      providerSubscriptionId: psubId,
      providerCustomerId: `cus_t4_${runId}`,
      status: SubscriptionStatus.INCOMPLETE_EXPIRED,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
      trialStart: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      seatsCount: 1,
    });

    const result = await reconcileSubscription(prisma, subId);

    expect(result.driftDetected).toBe(true);
    expect(result.actionTaken).toBe("STATUS_TRANSITIONED");
    expect(result.correctedState.status).toBe(SubscriptionStatus.INCOMPLETE_EXPIRED);

    const updated = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(updated?.status).toBe(SubscriptionStatus.INCOMPLETE_EXPIRED);
  });

  it("5. should execute sweep and idempotently handle re-runs on in-sync subscriptions", async () => {
    const fixture1 = await createWorkspaceAndAccount("t5_1");
    const fixture2 = await createWorkspaceAndAccount("t5_2");
    const subId1 = `sub_sweep_1_${runId}`;
    const subId2 = `sub_sweep_2_${runId}`;
    const psubId1 = `psub_sweep_1_${runId}`;
    const psubId2 = `psub_sweep_2_${runId}`;

    const now = new Date();
    const periodStart = new Date(now.getTime() - 5 * 86400000);
    const periodEnd = new Date(now.getTime() + 25 * 86400000);

    // Create 2 local subscriptions in PAST_DUE
    await prisma.subscription.create({
      data: {
        id: subId1,
        workspaceId: fixture1.workspaceId,
        accountId: fixture1.accountId,
        planId,
        status: SubscriptionStatus.PAST_DUE,
        providerSubscriptionId: psubId1,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gracePeriodEndsAt: new Date(now.getTime() + 2 * 86400000),
        dunningAttemptsCount: 1,
        seatsCount: 1,
      },
    });

    await prisma.subscription.create({
      data: {
        id: subId2,
        workspaceId: fixture2.workspaceId,
        accountId: fixture2.accountId,
        planId,
        status: SubscriptionStatus.PAST_DUE,
        providerSubscriptionId: psubId2,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gracePeriodEndsAt: new Date(now.getTime() + 2 * 86400000),
        dunningAttemptsCount: 1,
        seatsCount: 1,
      },
    });

    // Provider state is ACTIVE for both
    mockAdapter.setMockSubscription({
      providerSubscriptionId: psubId1,
      providerCustomerId: `cus_t5_1_${runId}`,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialStart: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      seatsCount: 1,
    });

    mockAdapter.setMockSubscription({
      providerSubscriptionId: psubId2,
      providerCustomerId: `cus_t5_2_${runId}`,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialStart: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      seatsCount: 1,
    });

    // Sweep 1: Corrects both to ACTIVE
    const sweep1 = await runReconciliationSweep(prisma, {
      workspaceIds: [fixture1.workspaceId, fixture2.workspaceId],
    });

    expect(sweep1.totalScanned).toBe(2);
    expect(sweep1.driftCount).toBe(2);
    expect(sweep1.correctedCount).toBe(2);
    expect(sweep1.errors).toHaveLength(0);

    // Sweep 2 (Idempotency): Both are now in-sync
    const sweep2 = await runReconciliationSweep(prisma, {
      workspaceIds: [fixture1.workspaceId, fixture2.workspaceId],
    });

    expect(sweep2.totalScanned).toBe(2);
    expect(sweep2.driftCount).toBe(0);
    expect(sweep2.inSyncCount).toBe(2);
    expect(sweep2.errors).toHaveLength(0);
  });

  it("6. concurrent webhook and reconciliation race handling without double-transition corruption", async () => {
    const { workspaceId, accountId } = await createWorkspaceAndAccount("t6");
    const subId = `sub_race_${runId}`;
    const psubId = `psub_race_${runId}`;
    const invoiceId = `inv_race_${runId}`;

    const now = new Date();
    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId,
        accountId,
        planId,
        status: SubscriptionStatus.PAST_DUE,
        providerSubscriptionId: psubId,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
        gracePeriodEndsAt: new Date(now.getTime() + 3 * 86400000),
        dunningAttemptsCount: 1,
        seatsCount: 1,
      },
    });

    mockAdapter.setMockSubscription({
      providerSubscriptionId: psubId,
      providerCustomerId: `cus_t6_${runId}`,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
      trialStart: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      seatsCount: 1,
    });

    // Execute webhook and reconciliation simultaneously
    const webhookPayload = {
      id: `evt_race_${runId}`,
      eventType: "invoice.payment_succeeded",
      provider: BillingProviderType.MOCK,
      data: {
        id: invoiceId,
        subscription: psubId,
        customer: `cus_t6_${runId}`,
        amount_due: 4900,
        amount_paid: 4900,
        currency: "usd",
      },
      rawEvent: { id: `evt_race_${runId}` },
    };

    const [webhookRes, reconRes] = await Promise.allSettled([
      processBillingWebhookEvent(prisma, webhookPayload),
      reconcileSubscription(prisma, subId),
    ]);

    expect(webhookRes.status).toBe("fulfilled");
    expect(reconRes.status).toBe("fulfilled");

    const finalSub = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(finalSub?.status).toBe(SubscriptionStatus.ACTIVE);
  });

  it("7. should throw SubscriptionNotFoundError for non-existent subscription", async () => {
    await expect(
      reconcileSubscription(prisma, `sub_nonexistent_${runId}`)
    ).rejects.toThrow(SubscriptionNotFoundError);
  });
});
