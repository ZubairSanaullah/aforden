import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { SubscriptionStatus, BillingInterval, PlanTier, FeatureValueType } from "../../generated/prisma/enums";
import { changeSubscriptionPlan } from "@/lib/services/billing/planChangeService";
import {
  PlanPriceNotFoundError,
  SubscriptionNotFoundError,
  InvalidSubscriptionStatusForPlanChangeError,
  DowngradeUsageExceededError,
} from "@/lib/services/billing/billingErrors";

describe("Phase 1.15.6 — PlanChangeService Integration Tests", () => {
  let prisma: PrismaClient;
  const runId = `pc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_pc_${runId}`;
  const starterCode = `starter_pc_${runId}`;
  const growthCode = `growth_pc_${runId}`;
  const actorUserId = `user_pc_${runId}`;

  let starterPlanId: string;
  let starterPriceId: string;
  let growthPlanId: string;
  let growthPriceId: string;
  let accountId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Create Workspace & User
    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Plan Change Workspace ${runId}`,
        slug: `pc-${runId}`,
      },
    });

    await prisma.user.create({
      data: {
        id: actorUserId,
        email: `actor-${runId}@example.com`,
        name: "Plan Change Actor",
      },
    });

    // 2. Create Billing Account (MOCK)
    const account = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsId,
        billingEmail: `billing-${runId}@example.com`,
        provider: "MOCK",
        providerCustomerId: `cus_mock_pc_${runId}`,
      },
    });
    accountId = account.id;

    // 3. Create Starter Plan with MAX_MEMBERS = 1 per seat
    const starterPlan = await prisma.subscriptionPlan.create({
      data: {
        code: starterCode,
        name: `Starter Plan ${runId}`,
        tier: PlanTier.STARTER,
        baseSeats: 1,
        isActive: true,
      },
    });
    starterPlanId = starterPlan.id;

    const starterPrice = await prisma.subscriptionPlanPrice.create({
      data: {
        planId: starterPlanId,
        currency: "USD",
        amountCents: 4900,
        billingInterval: BillingInterval.MONTHLY,
        providerPriceId: `price_starter_mock_${runId}`,
        isActive: true,
      },
    });
    starterPriceId = starterPrice.id;

    await prisma.subscriptionPlanFeature.create({
      data: {
        planId: starterPlanId,
        featureKey: "MAX_MEMBERS",
        featureType: FeatureValueType.NUMERIC_LIMIT,
        valueJson: 1,
        scalesWithSeats: true,
      },
    });

    // 4. Create Growth Plan with MAX_MEMBERS = 2 per seat
    const growthPlan = await prisma.subscriptionPlan.create({
      data: {
        code: growthCode,
        name: `Growth Plan ${runId}`,
        tier: PlanTier.GROWTH,
        baseSeats: 5,
        isActive: true,
      },
    });
    growthPlanId = growthPlan.id;

    const growthPrice = await prisma.subscriptionPlanPrice.create({
      data: {
        planId: growthPlanId,
        currency: "USD",
        amountCents: 14900,
        billingInterval: BillingInterval.MONTHLY,
        providerPriceId: `price_growth_mock_${runId}`,
        isActive: true,
      },
    });
    growthPriceId = growthPrice.id;

    await prisma.subscriptionPlanFeature.create({
      data: {
        planId: growthPlanId,
        featureKey: "MAX_MEMBERS",
        featureType: FeatureValueType.NUMERIC_LIMIT,
        valueJson: 2,
        scalesWithSeats: true,
      },
    });

    // 5. Create Initial Active Subscription on Starter Plan (1 seat)
    const sub = await prisma.subscription.create({
      data: {
        workspaceId: wsId,
        accountId,
        planId: starterPlanId,
        status: SubscriptionStatus.ACTIVE,
        providerSubscriptionId: `sub_pc_mock_${runId}`,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        seatsCount: 1,
      },
    });
    subscriptionId = sub.id;
  });

  afterAll(async () => {
    if (prisma) {
      try {
        await prisma.subscriptionHistory.deleteMany({
          where: { subscription: { workspaceId: wsId } },
        });
        await prisma.subscription.deleteMany({
          where: { workspaceId: wsId },
        });
        await prisma.workspaceMember.deleteMany({
          where: { workspaceId: wsId },
        });
        await prisma.subscriptionPlanFeature.deleteMany({
          where: { planId: { in: [starterPlanId, growthPlanId] } },
        });
        await prisma.subscriptionPlanPrice.deleteMany({
          where: { planId: { in: [starterPlanId, growthPlanId] } },
        });
        await prisma.subscriptionPlan.deleteMany({
          where: { id: { in: [starterPlanId, growthPlanId] } },
        });
        await prisma.platformBillingAccount.deleteMany({
          where: { workspaceId: wsId },
        });
        await prisma.user.deleteMany({
          where: { id: actorUserId },
        });
        await prisma.workspace.deleteMany({
          where: { id: wsId },
        });
      } catch (err) {
        console.error("Cleanup error in planChangeService.test.ts:", err);
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  it("1. should immediately upgrade active subscription to Growth plan with 5 seats and record history", async () => {
    const updated = await changeSubscriptionPlan(
      prisma,
      wsId,
      {
        priceId: growthPriceId,
        seatsCount: 5,
      },
      actorUserId
    );

    expect(updated).toBeDefined();
    expect(updated.planId).toBe(growthPlanId);
    expect(updated.seatsCount).toBe(5);

    // Verify history audit trail
    const history = await prisma.subscriptionHistory.findFirst({
      where: {
        subscriptionId: updated.id,
        triggerSource: "USER_ACTION:change_plan",
      },
    });
    expect(history).toBeDefined();
    expect(history?.actorUserId).toBe(actorUserId);
    expect((history?.metadataJson as any)?.newPlanId).toBe(growthPlanId);
    expect((history?.metadataJson as any)?.oldPlanId).toBe(starterPlanId);
    expect((history?.metadataJson as any)?.oldPriceId).toBe(starterPriceId);
    expect((history?.metadataJson as any)?.newPriceId).toBe(growthPriceId);
  });


  it("2. should reject downgrade if active members exceed target plan member quota", async () => {
    // Add 3 active workspace members
    const user1 = await prisma.user.create({ data: { email: `u1_${runId}@example.com` } });
    const user2 = await prisma.user.create({ data: { email: `u2_${runId}@example.com` } });
    const user3 = await prisma.user.create({ data: { email: `u3_${runId}@example.com` } });

    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: wsId, userId: user1.id, role: "ADMIN", status: "ACTIVE" },
        { workspaceId: wsId, userId: user2.id, role: "TECHNICIAN", status: "ACTIVE" },
        { workspaceId: wsId, userId: user3.id, role: "DISPATCHER", status: "ACTIVE" },
      ],
    });

    // Attempt to downgrade to Starter plan with 1 seat (Limit: 1 member < 3 active)
    await expect(
      changeSubscriptionPlan(
        prisma,
        wsId,
        {
          priceId: starterPriceId,
          seatsCount: 1,
        },
        actorUserId
      )
    ).rejects.toThrow(DowngradeUsageExceededError);

    // Clean up extra members
    await prisma.workspaceMember.deleteMany({
      where: { workspaceId: wsId },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [user1.id, user2.id, user3.id] } },
    });
  });

  it("3. should successfully downgrade when active usage is within target quota", async () => {
    const updated = await changeSubscriptionPlan(
      prisma,
      wsId,
      {
        priceId: starterPriceId,
        seatsCount: 1,
      },
      actorUserId
    );

    expect(updated.planId).toBe(starterPlanId);
    expect(updated.seatsCount).toBe(1);
  });

  it("4. should throw InvalidSubscriptionStatusForPlanChangeError if subscription is PAST_DUE", async () => {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.PAST_DUE },
    });

    await expect(
      changeSubscriptionPlan(
        prisma,
        wsId,
        {
          priceId: growthPriceId,
        },
        actorUserId
      )
    ).rejects.toThrow(InvalidSubscriptionStatusForPlanChangeError);

    // Restore to ACTIVE
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.ACTIVE },
    });
  });

  it("5. should throw InvalidSubscriptionStatusForPlanChangeError if subscription is PAUSED", async () => {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.PAUSED },
    });

    await expect(
      changeSubscriptionPlan(
        prisma,
        wsId,
        {
          priceId: growthPriceId,
        },
        actorUserId
      )
    ).rejects.toThrow(InvalidSubscriptionStatusForPlanChangeError);

    // Restore to ACTIVE
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.ACTIVE },
    });
  });

  it("6. should throw SubscriptionNotFoundError if no non-terminal subscription exists", async () => {
    const nonExistentWsId = `ws_none_${runId}`;

    await expect(
      changeSubscriptionPlan(
        prisma,
        nonExistentWsId,
        {
          priceId: growthPriceId,
        },
        actorUserId
      )
    ).rejects.toThrow(SubscriptionNotFoundError);
  });
});
