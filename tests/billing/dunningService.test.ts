/**
 * Phase 1.15.9 — Dunning Engine & Grace Periods Integration Tests
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
  runDunningSweep,
  processSubscriptionDunningAttempt,
} from "@/lib/services/billing/dunningService";
import { processBillingWebhookEvent } from "@/lib/services/billing/webhookService";
import { SubscriptionNotFoundError } from "@/lib/services/billing/billingErrors";

describe("Phase 1.15.9 — Dunning Engine & Grace Periods Integration Tests", { timeout: 30000 }, () => {
  let prisma: PrismaClient;
  const runId = `dun_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const planCode = `plan_dun_${runId}`;
  let planId: string;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // Create Shared Subscription Plan
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code: planCode,
        name: `Dunning Plan ${runId}`,
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
        console.error("Cleanup error in dunningService.test.ts:", err);
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  async function createWorkspaceAndAccount(suffix: string) {
    const ws = await prisma.workspace.create({
      data: {
        id: `ws_${runId}_${suffix}`,
        name: `Dunning WS ${suffix} ${runId}`,
        slug: `dun-${suffix}-${runId}`,
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

  it("1. should maintain PAST_DUE during active grace period without state mutation", async () => {
    const { workspaceId, accountId } = await createWorkspaceAndAccount("t1");
    const subId = `sub_grace_active_${runId}`;
    const now = new Date();
    const futureGrace = new Date(now.getTime() + 4 * 86400000); // 4 days remaining

    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId,
        accountId,
        planId,
        status: SubscriptionStatus.PAST_DUE,
        providerSubscriptionId: `psub_grace_${runId}`,
        currentPeriodStart: new Date(now.getTime() - 15 * 86400000),
        currentPeriodEnd: new Date(now.getTime() + 15 * 86400000),
        gracePeriodEndsAt: futureGrace,
        dunningAttemptsCount: 1,
        seatsCount: 1,
      },
    });

    const result = await processSubscriptionDunningAttempt(prisma, subId, {
      referenceDate: now,
    });

    expect(result.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(result.actionTaken).toBe("ACTIVE_GRACE_PERIOD");
    expect(result.remainingGraceDays).toBe(4);

    // Verify DB record unchanged
    const sub = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(sub?.status).toBe(SubscriptionStatus.PAST_DUE);
  });

  it("2. should transition PAST_DUE -> UNPAID at exact grace period expiration boundary", async () => {
    const { workspaceId, accountId } = await createWorkspaceAndAccount("t2");
    const subId = `sub_boundary_${runId}`;
    const graceExpiry = new Date(Date.now() + 1000); // 1 second in future

    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId,
        accountId,
        planId,
        status: SubscriptionStatus.PAST_DUE,
        providerSubscriptionId: `psub_boundary_${runId}`,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        gracePeriodEndsAt: graceExpiry,
        dunningAttemptsCount: 2,
        seatsCount: 1,
      },
    });

    // Sub-test A: 1ms before expiry -> ACTIVE_GRACE_PERIOD
    const beforeResult = await processSubscriptionDunningAttempt(prisma, subId, {
      referenceDate: new Date(graceExpiry.getTime() - 1),
    });
    expect(beforeResult.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(beforeResult.actionTaken).toBe("ACTIVE_GRACE_PERIOD");

    // Sub-test B: Exactly at expiry -> TRANSITIONED_TO_UNPAID
    const atExpiryResult = await processSubscriptionDunningAttempt(prisma, subId, {
      referenceDate: graceExpiry,
    });
    expect(atExpiryResult.status).toBe(SubscriptionStatus.UNPAID);
    expect(atExpiryResult.actionTaken).toBe("TRANSITIONED_TO_UNPAID");

    const updatedSub = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(updatedSub?.status).toBe(SubscriptionStatus.UNPAID);
  });

  it("3. should execute dunning sweep and idempotently handle re-runs", async () => {
    const fixture1 = await createWorkspaceAndAccount("t3_1");
    const fixture2 = await createWorkspaceAndAccount("t3_2");
    const subId1 = `sub_sweep_1_${runId}`;
    const subId2 = `sub_sweep_2_${runId}`;
    const pastDate = new Date(Date.now() - 2 * 86400000); // Expired 2 days ago

    await prisma.subscription.create({
      data: {
        id: subId1,
        workspaceId: fixture1.workspaceId,
        accountId: fixture1.accountId,
        planId,
        status: SubscriptionStatus.PAST_DUE,
        providerSubscriptionId: `psub_sweep_1_${runId}`,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        gracePeriodEndsAt: pastDate,
        dunningAttemptsCount: 2,
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
        providerSubscriptionId: `psub_sweep_2_${runId}`,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        gracePeriodEndsAt: pastDate,
        dunningAttemptsCount: 3,
        seatsCount: 1,
      },
    });

    // Run 1: Should transition both to UNPAID
    const sweep1 = await runDunningSweep(prisma, {
      workspaceIds: [fixture1.workspaceId, fixture2.workspaceId],
      referenceDate: new Date(),
    });
    expect(sweep1.processedPastDueCount).toBe(2);
    expect(sweep1.transitionedToUnpaidCount).toBe(2);
    expect(sweep1.errors).toHaveLength(0);

    const sub1After = await prisma.subscription.findUnique({ where: { id: subId1 } });
    const sub2After = await prisma.subscription.findUnique({ where: { id: subId2 } });
    expect(sub1After?.status).toBe(SubscriptionStatus.UNPAID);
    expect(sub2After?.status).toBe(SubscriptionStatus.UNPAID);

    // Run 2 (Idempotency check): Re-running sweep immediately should find 0 expired PAST_DUE
    const sweep2 = await runDunningSweep(prisma, {
      workspaceIds: [fixture1.workspaceId, fixture2.workspaceId],
      referenceDate: new Date(),
    });
    expect(sweep2.transitionedToUnpaidCount).toBe(0);
    expect(sweep2.errors).toHaveLength(0);
  });


  it("4. mid-cycle payment recovery resets dunning counters and restores ACTIVE status", async () => {
    const { workspaceId, accountId } = await createWorkspaceAndAccount("t4");
    const subId = `sub_recovery_${runId}`;
    const providerSubId = `psub_rec_${runId}`;
    const providerCustId = `cus_rec_${runId}`;
    const invoiceId = `in_rec_${runId}`;
    const paymentId = `pmt_rec_${runId}`;

    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId,
        accountId,
        planId,
        status: SubscriptionStatus.PAST_DUE,
        providerSubscriptionId: providerSubId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        gracePeriodEndsAt: new Date(Date.now() + 3 * 86400000),
        dunningAttemptsCount: 2,
        seatsCount: 1,
      },
    });

    // Simulate payment success webhook mid-cycle
    const webhookPayload = {
      id: `evt_rec_${runId}`,
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
      },
      rawEvent: { id: `evt_rec_${runId}`, created: Math.floor(Date.now() / 1000) },
    };

    const webhookRes = await processBillingWebhookEvent(prisma, webhookPayload);
    expect(webhookRes.processed).toBe(true);

    // Verify subscription recovered
    const recoveredSub = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(recoveredSub?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(recoveredSub?.gracePeriodEndsAt).toBeNull();
    expect(recoveredSub?.dunningAttemptsCount).toBe(0);

    // Verify subsequent dunning attempt evaluation returns NOOP
    const attemptRes = await processSubscriptionDunningAttempt(prisma, subId);
    expect(attemptRes.status).toBe(SubscriptionStatus.ACTIVE);
    expect(attemptRes.actionTaken).toBe("NOOP");
  });

  it("5. should transition TRIALING -> PAST_DUE when trialEnd has elapsed", async () => {
    const { workspaceId, accountId } = await createWorkspaceAndAccount("t5");
    const subId = `sub_trial_${runId}`;
    const pastTrialEnd = new Date(Date.now() - 1000);

    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId,
        accountId,
        planId,
        status: SubscriptionStatus.TRIALING,
        providerSubscriptionId: `psub_trial_${runId}`,
        currentPeriodStart: new Date(Date.now() - 14 * 86400000),
        currentPeriodEnd: new Date(Date.now() + 16 * 86400000),
        trialStart: new Date(Date.now() - 14 * 86400000),
        trialEnd: pastTrialEnd,
        seatsCount: 1,
      },
    });

    const result = await processSubscriptionDunningAttempt(prisma, subId, {
      referenceDate: new Date(),
    });

    expect(result.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(result.actionTaken).toBe("TRANSITIONED_TO_PAST_DUE");

    const updatedSub = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(updatedSub?.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(updatedSub?.gracePeriodEndsAt).toBeDefined();
    expect(updatedSub?.dunningAttemptsCount).toBe(1);
  });

  it("6. should transition UNPAID -> CANCELED when unpaid retention period expires", async () => {
    const { workspaceId, accountId } = await createWorkspaceAndAccount("t6");
    const subId = `sub_unpaid_term_${runId}`;
    const oldUpdate = new Date(Date.now() - 20 * 86400000); // 20 days ago (exceeds 14-day retention)

    await prisma.subscription.create({
      data: {
        id: subId,
        workspaceId,
        accountId,
        planId,
        status: SubscriptionStatus.UNPAID,
        providerSubscriptionId: `psub_unpaid_${runId}`,
        currentPeriodStart: new Date(Date.now() - 45 * 86400000),
        currentPeriodEnd: new Date(Date.now() - 15 * 86400000),
        updatedAt: oldUpdate,
        seatsCount: 1,
      },
    });

    // Manually ensure updatedAt is set to the past timestamp in DB
    await prisma.subscription.update({
      where: { id: subId },
      data: { updatedAt: oldUpdate },
    });

    const result = await processSubscriptionDunningAttempt(prisma, subId, {
      referenceDate: new Date(),
      unpaidRetentionDays: 14,
    });

    expect(result.status).toBe(SubscriptionStatus.CANCELED);
    expect(result.actionTaken).toBe("TRANSITIONED_TO_CANCELED");

    const updatedSub = await prisma.subscription.findUnique({ where: { id: subId } });
    expect(updatedSub?.status).toBe(SubscriptionStatus.CANCELED);
    expect(updatedSub?.canceledAt).toBeDefined();
    expect(updatedSub?.endedAt).toBeDefined();
  });

  it("7. should throw SubscriptionNotFoundError for non-existent subscription", async () => {
    await expect(
      processSubscriptionDunningAttempt(prisma, `sub_nonexistent_${runId}`)
    ).rejects.toThrow(SubscriptionNotFoundError);
  });
});
