import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { SubscriptionStatus, BillingInterval, PlanTier } from "../../generated/prisma/enums";
import { createCheckoutSession } from "@/lib/services/billing/checkoutService";
import {
  DuplicateActiveSubscriptionError,
  PlanPriceNotFoundError,
} from "@/lib/services/billing/billingErrors";

describe("Phase 1.15.6 — CheckoutSessionService Integration Tests", () => {
  let prisma: PrismaClient;
  const runId = `cs_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_${runId}`;
  const wsWithActiveSubId = `ws_active_${runId}`;
  const wsWithCanceledSubId = `ws_canc_${runId}`;
  const planCode = `plan_cs_${runId}`;

  let planId: string;
  let activePriceId: string;
  let inactivePriceId: string;
  let accountId: string;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Create primary test workspace
    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Checkout Test Workspace ${runId}`,
        slug: `cs-${runId}`,
      },
    });

    // 2. Create billing account for primary workspace (MOCK provider)
    const account = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsId,
        billingEmail: `billing-${runId}@example.com`,
        provider: "MOCK",
        providerCustomerId: `cus_mock_${runId}`,
      },
    });
    accountId = account.id;

    // 3. Create active subscription plan with active and inactive prices
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code: planCode,
        name: `Checkout Plan ${runId}`,
        tier: PlanTier.STARTER,
        baseSeats: 2,
        isActive: true,
      },
    });
    planId = plan.id;

    const activePrice = await prisma.subscriptionPlanPrice.create({
      data: {
        planId,
        currency: "USD",
        amountCents: 4900,
        billingInterval: BillingInterval.MONTHLY,
        providerPriceId: `price_active_${runId}`,
        isActive: true,
      },
    });
    activePriceId = activePrice.id;

    const inactivePrice = await prisma.subscriptionPlanPrice.create({
      data: {
        planId,
        currency: "USD",
        amountCents: 49000,
        billingInterval: BillingInterval.ANNUAL,
        providerPriceId: `price_inactive_${runId}`,
        isActive: false,
      },
    });
    inactivePriceId = inactivePrice.id;

    // 4. Create workspace with active subscription
    await prisma.workspace.create({
      data: {
        id: wsWithActiveSubId,
        name: `Workspace with Active Sub ${runId}`,
        slug: `ws-active-${runId}`,
      },
    });

    const activeAccount = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsWithActiveSubId,
        billingEmail: `active-${runId}@example.com`,
        provider: "MOCK",
        providerCustomerId: `cus_active_${runId}`,
      },
    });

    await prisma.subscription.create({
      data: {
        workspaceId: wsWithActiveSubId,
        accountId: activeAccount.id,
        planId,
        status: SubscriptionStatus.ACTIVE,
        providerSubscriptionId: `sub_active_${runId}`,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        seatsCount: 2,
      },
    });

    // 5. Create workspace with canceled subscription
    await prisma.workspace.create({
      data: {
        id: wsWithCanceledSubId,
        name: `Workspace with Canceled Sub ${runId}`,
        slug: `ws-canc-${runId}`,
      },
    });

    const canceledAccount = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsWithCanceledSubId,
        billingEmail: `canc-${runId}@example.com`,
        provider: "MOCK",
        providerCustomerId: `cus_canc_${runId}`,
      },
    });

    await prisma.subscription.create({
      data: {
        workspaceId: wsWithCanceledSubId,
        accountId: canceledAccount.id,
        planId,
        status: SubscriptionStatus.CANCELED,
        providerSubscriptionId: `sub_canc_${runId}`,
        currentPeriodStart: new Date(Date.now() - 60 * 86400000),
        currentPeriodEnd: new Date(Date.now() - 30 * 86400000),
        canceledAt: new Date(Date.now() - 30 * 86400000),
        endedAt: new Date(Date.now() - 30 * 86400000),
        seatsCount: 1,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      try {
        await prisma.subscriptionHistory.deleteMany({
          where: {
            subscription: {
              workspaceId: { in: [wsId, wsWithActiveSubId, wsWithCanceledSubId] },
            },
          },
        });
        await prisma.subscription.deleteMany({
          where: {
            workspaceId: { in: [wsId, wsWithActiveSubId, wsWithCanceledSubId] },
          },
        });
        await prisma.subscriptionPlanPrice.deleteMany({
          where: { planId },
        });
        await prisma.subscriptionPlan.deleteMany({
          where: { id: planId },
        });
        await prisma.platformBillingAccount.deleteMany({
          where: {
            workspaceId: { in: [wsId, wsWithActiveSubId, wsWithCanceledSubId] },
          },
        });
        await prisma.workspace.deleteMany({
          where: {
            id: { in: [wsId, wsWithActiveSubId, wsWithCanceledSubId] },
          },
        });
      } catch (err) {
        console.error("Cleanup error in checkoutService.test.ts:", err);
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  it("1. should create a checkout session for a workspace with no subscriptions", async () => {
    const result = await createCheckoutSession(prisma, wsId, {
      priceId: activePriceId,
      quantity: 3,
      successUrl: "https://aforden.com/billing/success",
      cancelUrl: "https://aforden.com/billing/cancel",
    });

    expect(result).toBeDefined();
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionUrl).toContain("https://mock-billing.aforden.internal/checkout/");
  });

  it("2. should reject checkout session creation if an active subscription exists (Single Active Subscription Invariant)", async () => {
    await expect(
      createCheckoutSession(prisma, wsWithActiveSubId, {
        priceId: activePriceId,
        successUrl: "https://aforden.com/billing/success",
        cancelUrl: "https://aforden.com/billing/cancel",
      })
    ).rejects.toThrow(DuplicateActiveSubscriptionError);
  });

  it("3. should allow checkout session creation if existing subscription is in terminal status (CANCELED)", async () => {
    const result = await createCheckoutSession(prisma, wsWithCanceledSubId, {
      priceId: activePriceId,
      quantity: 2,
      successUrl: "https://aforden.com/billing/success",
      cancelUrl: "https://aforden.com/billing/cancel",
    });

    expect(result).toBeDefined();
    expect(result.sessionId).toBeTruthy();
  });

  it("4. should throw PlanPriceNotFoundError when price does not exist", async () => {
    await expect(
      createCheckoutSession(prisma, wsId, {
        priceId: "non_existent_price_id",
        successUrl: "https://aforden.com/billing/success",
        cancelUrl: "https://aforden.com/billing/cancel",
      })
    ).rejects.toThrow(PlanPriceNotFoundError);
  });

  it("5. should throw PlanPriceNotFoundError when price is inactive", async () => {
    await expect(
      createCheckoutSession(prisma, wsId, {
        priceId: inactivePriceId,
        successUrl: "https://aforden.com/billing/success",
        cancelUrl: "https://aforden.com/billing/cancel",
      })
    ).rejects.toThrow(PlanPriceNotFoundError);
  });

  it("6. should lazily create PlatformBillingAccount and customer on provider if missing", async () => {
    const freshWsId = `ws_fresh_${runId}`;
    await prisma.workspace.create({
      data: {
        id: freshWsId,
        name: `Fresh Workspace ${runId}`,
        slug: `ws-fresh-${runId}`,
      },
    });

    try {
      const result = await createCheckoutSession(
        prisma,
        freshWsId,
        {
          priceId: activePriceId,
          successUrl: "https://aforden.com/billing/success",
          cancelUrl: "https://aforden.com/billing/cancel",
        },
        {
          customerEmail: `fresh-${runId}@example.com`,
          customerName: "Fresh Workspace Owner",
        }
      );

      expect(result.sessionId).toBeTruthy();

      const createdAccount = await prisma.platformBillingAccount.findUnique({
        where: { workspaceId: freshWsId },
      });
      expect(createdAccount).toBeDefined();
      expect(createdAccount?.billingEmail).toBe(`fresh-${runId}@example.com`);
      expect(createdAccount?.providerCustomerId).toBeTruthy();
    } finally {
      await prisma.platformBillingAccount.deleteMany({
        where: { workspaceId: freshWsId },
      });
      await prisma.workspace.deleteMany({
        where: { id: freshWsId },
      });
    }
  });
});
