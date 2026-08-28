import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import {
  seedSubscriptionPlans,
  SEED_SUBSCRIPTION_PLANS,
} from "@/lib/services/billing/seedSubscriptionPlans";
import { ENTITLEMENT_KEYS } from "@/lib/services/billing/entitlementRegistry";

describe("Phase 1.15.2 — Subscription Plans Seed Integrity & Idempotency Tests", { timeout: 30000 }, () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it("1. should seed all 3 subscription plans idempotently on first run", async () => {
    const result = await seedSubscriptionPlans(prisma);
    expect(result.plansCount).toBe(3);
    expect(result.pricesCount).toBe(6); // 2 prices per plan
    expect(result.featuresCount).toBe(33); // 11 features per plan
  });

  it("2. should be completely idempotent when re-run multiple times", async () => {
    const secondRun = await seedSubscriptionPlans(prisma);
    expect(secondRun.plansCount).toBe(3);
    expect(secondRun.pricesCount).toBe(6);
    expect(secondRun.featuresCount).toBe(33);

    const plans = await prisma.subscriptionPlan.findMany({
      where: { code: { in: ["starter", "growth", "enterprise"] } },
      include: { prices: true, features: true },
    });

    expect(plans).toHaveLength(3);
    for (const plan of plans) {
      expect(plan.prices).toHaveLength(2);
      expect(plan.features).toHaveLength(11);
    }
  });

  it("3. should verify all plan prices have valid positive amounts and currencies", async () => {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { code: { in: ["starter", "growth", "enterprise"] } },
      include: { prices: true },
    });

    for (const plan of plans) {
      const monthly = plan.prices.find((p) => p.billingInterval === "MONTHLY");
      const annual = plan.prices.find((p) => p.billingInterval === "ANNUAL");

      expect(monthly).toBeDefined();
      expect(annual).toBeDefined();
      expect(monthly!.amountCents).toBeGreaterThan(0);
      expect(annual!.amountCents).toBeGreaterThan(0);
      expect(monthly!.currency).toBe("USD");
      expect(annual!.currency).toBe("USD");
    }
  });

  it("4. should verify every plan has a feature entry for all 11 ENTITLEMENT_KEYS", async () => {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { code: { in: ["starter", "growth", "enterprise"] } },
      include: { features: true },
    });

    for (const plan of plans) {
      const planFeatureKeys = plan.features.map((f) => f.featureKey).sort();
      const expectedKeys = [...ENTITLEMENT_KEYS].sort();
      expect(planFeatureKeys).toEqual(expectedKeys);
    }
  });

  it("5. should assert all scalesWithSeats features have positive integer multipliers or UNLIMITED", async () => {
    const features = await prisma.subscriptionPlanFeature.findMany({
      where: {
        scalesWithSeats: true,
        plan: { code: { in: ["starter", "growth", "enterprise"] } },
      },
    });


    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      const val = feature.valueJson;
      if (val !== "UNLIMITED") {
        const num = Number(val);
        expect(Number.isInteger(num)).toBe(true);
        expect(num).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("6. SEED_SUBSCRIPTION_PLANS static data should satisfy all multiplier invariants", () => {
    for (const plan of SEED_SUBSCRIPTION_PLANS) {
      for (const [key, feat] of Object.entries(plan.features)) {
        if (feat.scalesWithSeats) {
          if (feat.valueJson !== "UNLIMITED") {
            const num = Number(feat.valueJson);
            expect(Number.isInteger(num)).toBe(true);
            expect(num).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });
});
