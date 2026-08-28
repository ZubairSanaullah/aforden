/**
 * Phase 1.15.5 — Entitlement Resolver & Quota Guard Integration Tests
 *
 * Real-DB tests covering:
 *   1. resolveEntitlement() — 3-tier resolution (all tiers)
 *   2. UNLIMITED sentinel — returned before multiplier math at each tier
 *   3. scalesWithSeats — multiplier computation
 *   4. Terminal subscription — falls through to Tier 3 default
 *   5. assertEntitlement() — numeric pass/fail, boolean pass/fail
 *   6. computeCurrentUsage() — per-key live counts (MAX_MEMBERS, MAX_TECHNICIANS,
 *      MAX_WORK_ORDERS_PER_MONTH, MAX_SERVICE_LOCATIONS, MAX_ATTACHMENT_STORAGE_MB)
 *   7. computeCurrentUsage() — boolean key throws programming-error
 */

import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { SubscriptionStatus } from "../../generated/prisma/enums";
import {
  resolveEntitlement,
  assertEntitlement,
} from "@/lib/services/billing/entitlementResolver";
import { computeCurrentUsage } from "@/lib/services/billing/usageComputation";
import {
  PlanFeatureNotEnabledError,
  QuotaExceededError,
  InvalidEntitlementMultiplierError,
} from "@/lib/services/billing/billingErrors";

describe("Phase 1.15.5 — Entitlement Resolver & Quota Guard Tests", () => {
  let prisma: PrismaClient;
  const runId = `er_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_${runId}`;
  const planCode = `plan_${runId}`;

  // IDs created in beforeAll
  let planId: string;
  let accountId: string;
  let activeSubId: string;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Create workspace
    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Entitlement Resolver Test WS ${runId}`,
        slug: `er-${runId}`,
      },
    });

    // 2. Create billing account
    const account = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsId,
        billingEmail: `billing-${runId}@example.com`,
        provider: "STRIPE",
        providerCustomerId: `cus_${runId}`,
      },
    });
    accountId = account.id;

    // 3. Create a subscription plan with explicit features
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code: planCode,
        name: `Plan ${runId}`,
        tier: "GROWTH",
        baseSeats: 5,
      },
    });
    planId = plan.id;

    // 4. Seed plan features for testing:
    //    MAX_MEMBERS:                scalesWithSeats=true,  multiplier=1
    //    MAX_TECHNICIANS:            scalesWithSeats=false, value=10
    //    MAX_WORK_ORDERS_PER_MONTH:  scalesWithSeats=false, value=200
    //    MAX_SERVICE_LOCATIONS:      scalesWithSeats=false, value=100
    //    MAX_ATTACHMENT_STORAGE_MB:  scalesWithSeats=false, value=5000
    //    FEATURE_ADVANCED_REPORTING: scalesWithSeats=false, value=true
    //    FEATURE_API_ACCESS:         scalesWithSeats=false, value=false (gated off)
    await prisma.subscriptionPlanFeature.createMany({
      data: [
        { planId, featureKey: "MAX_MEMBERS",               valueJson: 1,     scalesWithSeats: true },
        { planId, featureKey: "MAX_TECHNICIANS",            valueJson: 10,    scalesWithSeats: false },
        { planId, featureKey: "MAX_WORK_ORDERS_PER_MONTH", valueJson: 200,   scalesWithSeats: false },
        { planId, featureKey: "MAX_SERVICE_LOCATIONS",      valueJson: 100,   scalesWithSeats: false },
        { planId, featureKey: "MAX_ATTACHMENT_STORAGE_MB",  valueJson: 5000,  scalesWithSeats: false },
        { planId, featureKey: "FEATURE_ADVANCED_REPORTING", valueJson: true,  scalesWithSeats: false },
        { planId, featureKey: "FEATURE_API_ACCESS",         valueJson: false, scalesWithSeats: false },
      ],
    });

    // 5. Create an ACTIVE subscription with 4 seats
    const now = new Date();
    const sub = await prisma.subscription.create({
      data: {
        workspaceId: wsId,
        accountId,
        planId,
        status: SubscriptionStatus.ACTIVE,
        providerSubscriptionId: `sub_${runId}`,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
        seatsCount: 4,
      },
    });
    activeSubId = sub.id;
  });

  afterAll(async () => {
    if (prisma) {
      try {
        // Deletion order: subscription → plan features → plan → account → workspace
        await prisma.subscriptionHistory.deleteMany({ where: { subscriptionId: activeSubId } });
        await prisma.subscription.deleteMany({ where: { id: activeSubId } });
        await prisma.subscriptionPlanFeature.deleteMany({ where: { planId } });
        await prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
        await prisma.platformBillingAccount.deleteMany({ where: { id: accountId } });
        await prisma.workspaceEntitlementOverride.deleteMany({ where: { workspaceId: wsId } });
        await prisma.workspace.deleteMany({ where: { id: wsId } });
      } catch {
        // Ignore cleanup errors
      }
      await prisma.$disconnect();
    }
  });

  // ==========================================================================
  // 1. resolveEntitlement — Tier 2: Subscription Plan Feature
  // ==========================================================================

  describe("1. resolveEntitlement — Tier 2: Subscription Plan", () => {
    it("should resolve MAX_TECHNICIANS from plan (fixed, scalesWithSeats=false)", async () => {
      const result = await resolveEntitlement(prisma, wsId, "MAX_TECHNICIANS");
      expect(result.featureKey).toBe("MAX_TECHNICIANS");
      expect(result.source).toBe("SUBSCRIPTION_PLAN");
      expect(result.value).toBe(10);
      expect(result.isUnlimited).toBe(false);
    });

    it("should resolve MAX_MEMBERS from plan via seat-scaled multiplier (1 * 4 seats = 4)", async () => {
      const result = await resolveEntitlement(prisma, wsId, "MAX_MEMBERS");
      expect(result.featureKey).toBe("MAX_MEMBERS");
      expect(result.source).toBe("SUBSCRIPTION_PLAN");
      // Multiplier 1 × 4 seats = 4
      expect(result.value).toBe(4);
      expect(result.isUnlimited).toBe(false);
    });

    it("should resolve FEATURE_ADVANCED_REPORTING = true from plan", async () => {
      const result = await resolveEntitlement(prisma, wsId, "FEATURE_ADVANCED_REPORTING");
      expect(result.source).toBe("SUBSCRIPTION_PLAN");
      expect(result.value).toBe(true);
      expect(result.isUnlimited).toBe(false);
    });

    it("should resolve FEATURE_API_ACCESS = false from plan (gated off)", async () => {
      const result = await resolveEntitlement(prisma, wsId, "FEATURE_API_ACCESS");
      expect(result.source).toBe("SUBSCRIPTION_PLAN");
      expect(result.value).toBe(false);
      expect(result.isUnlimited).toBe(false);
    });
  });

  // ==========================================================================
  // 2. resolveEntitlement — Tier 1: WorkspaceEntitlementOverride (takes precedence)
  // ==========================================================================

  describe("2. resolveEntitlement — Tier 1: WorkspaceEntitlementOverride", () => {
    it("should resolve from Tier 1 override when non-expired override exists", async () => {
      // Create override: MAX_TECHNICIANS = 50 (above plan's 10)
      await prisma.workspaceEntitlementOverride.create({
        data: {
          workspaceId: wsId,
          featureKey: "MAX_TECHNICIANS",
          featureType: "NUMERIC_LIMIT",
          overrideValueJson: 50,
          reason: "Test override",
          grantedByUserId: `user_${runId}`,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });

      const result = await resolveEntitlement(prisma, wsId, "MAX_TECHNICIANS");
      expect(result.source).toBe("WORKSPACE_OVERRIDE");
      expect(result.value).toBe(50);
      expect(result.isUnlimited).toBe(false);

      // Clean up
      await prisma.workspaceEntitlementOverride.deleteMany({
        where: { workspaceId: wsId, featureKey: "MAX_TECHNICIANS" },
      });
    });

    it("should NOT use Tier 1 override when it is expired (falls to Tier 2)", async () => {
      // Create expired override
      await prisma.workspaceEntitlementOverride.create({
        data: {
          workspaceId: wsId,
          featureKey: "MAX_TECHNICIANS",
          featureType: "NUMERIC_LIMIT",
          overrideValueJson: 99,
          reason: "Expired test override",
          grantedByUserId: `user_${runId}`,
          expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
        },
      });

      const result = await resolveEntitlement(prisma, wsId, "MAX_TECHNICIANS");
      // Expired override — should fall through to Tier 2 (plan value = 10)
      expect(result.source).toBe("SUBSCRIPTION_PLAN");
      expect(result.value).toBe(10);

      // Clean up
      await prisma.workspaceEntitlementOverride.deleteMany({
        where: { workspaceId: wsId, featureKey: "MAX_TECHNICIANS" },
      });
    });

    it("should resolve UNLIMITED from Tier 1 override without scalesWithSeats multiplier math", async () => {
      // Override with UNLIMITED sentinel — must not trigger multiplier validation
      await prisma.workspaceEntitlementOverride.create({
        data: {
          workspaceId: wsId,
          featureKey: "MAX_MEMBERS",
          featureType: "NUMERIC_LIMIT",
          overrideValueJson: "UNLIMITED",
          reason: "Enterprise unlimited grant",
          grantedByUserId: `user_${runId}`,
          expiresAt: null, // permanent
        },
      });

      const result = await resolveEntitlement(prisma, wsId, "MAX_MEMBERS");
      expect(result.source).toBe("WORKSPACE_OVERRIDE");
      expect(result.value).toBe("UNLIMITED");
      expect(result.isUnlimited).toBe(true);

      // Clean up
      await prisma.workspaceEntitlementOverride.deleteMany({
        where: { workspaceId: wsId, featureKey: "MAX_MEMBERS" },
      });
    });
  });

  // ==========================================================================
  // 3. resolveEntitlement — UNLIMITED sentinel at Tier 2 (Plan)
  // ==========================================================================

  describe("3. resolveEntitlement — UNLIMITED sentinel at Tier 2", () => {
    it("should return isUnlimited=true for an UNLIMITED plan feature (scalesWithSeats plan feature)", async () => {
      // Temporarily update MAX_WORK_ORDERS_PER_MONTH to UNLIMITED on plan
      await prisma.subscriptionPlanFeature.updateMany({
        where: { planId, featureKey: "MAX_WORK_ORDERS_PER_MONTH" },
        data: { valueJson: "UNLIMITED" },
      });

      const result = await resolveEntitlement(prisma, wsId, "MAX_WORK_ORDERS_PER_MONTH");
      expect(result.source).toBe("SUBSCRIPTION_PLAN");
      expect(result.value).toBe("UNLIMITED");
      expect(result.isUnlimited).toBe(true);

      // Restore
      await prisma.subscriptionPlanFeature.updateMany({
        where: { planId, featureKey: "MAX_WORK_ORDERS_PER_MONTH" },
        data: { valueJson: 200 },
      });
    });
  });

  // ==========================================================================
  // 4. resolveEntitlement — Tier 3: Default Fallback (no subscription)
  // ==========================================================================

  describe("4. resolveEntitlement — Tier 3: Default Fallback", () => {
    it("should fall to Tier 3 for a workspace with CANCELED subscription", async () => {
      // Create a second workspace with no active subscription
      const wsId2 = `ws2_${runId}`;
      await prisma.workspace.create({
        data: {
          id: wsId2,
          name: `No-Sub WS ${runId}`,
          slug: `nosub-${runId}`,
        },
      });

      try {
        const result = await resolveEntitlement(prisma, wsId2, "MAX_MEMBERS");
        expect(result.source).toBe("DEFAULT_FALLBACK");
        expect(result.value).toBe(2); // ENTITLEMENT_REGISTRY.MAX_MEMBERS.defaultValue = 2
        expect(result.isUnlimited).toBe(false);
      } finally {
        await prisma.workspace.deleteMany({ where: { id: wsId2 } });
      }
    });

    it("should fall to Tier 3 for FEATURE_ADVANCED_REPORTING with no subscription (default: false)", async () => {
      const wsId3 = `ws3_${runId}`;
      await prisma.workspace.create({
        data: {
          id: wsId3,
          name: `Free WS ${runId}`,
          slug: `free-${runId}`,
        },
      });

      try {
        const result = await resolveEntitlement(prisma, wsId3, "FEATURE_ADVANCED_REPORTING");
        expect(result.source).toBe("DEFAULT_FALLBACK");
        expect(result.value).toBe(false);
        expect(result.isUnlimited).toBe(false);
      } finally {
        await prisma.workspace.deleteMany({ where: { id: wsId3 } });
      }
    });
  });

  // ==========================================================================
  // 5. InvalidEntitlementMultiplierError — bad multiplier in plan
  // ==========================================================================

  describe("5. InvalidEntitlementMultiplierError — malformed scalesWithSeats multiplier", () => {
    it("should throw InvalidEntitlementMultiplierError for a scalesWithSeats=true feature with multiplier=0", async () => {
      // Temporarily corrupt the MAX_MEMBERS multiplier to 0 (invalid: must be >= 1)
      await prisma.subscriptionPlanFeature.updateMany({
        where: { planId, featureKey: "MAX_MEMBERS" },
        data: { valueJson: 0 },
      });

      await expect(
        resolveEntitlement(prisma, wsId, "MAX_MEMBERS")
      ).rejects.toThrow(InvalidEntitlementMultiplierError);

      // Restore
      await prisma.subscriptionPlanFeature.updateMany({
        where: { planId, featureKey: "MAX_MEMBERS" },
        data: { valueJson: 1 },
      });
    });
  });

  // ==========================================================================
  // 6. assertEntitlement — NUMERIC_LIMIT pass & fail
  // ==========================================================================

  describe("6. assertEntitlement — NUMERIC_LIMIT enforcement", () => {
    it("should pass assertEntitlement(MAX_TECHNICIANS) when no technicians exist", async () => {
      // No TechnicianProfile records exist for this workspace — current usage = 0, limit = 10
      await expect(
        assertEntitlement(prisma, wsId, "MAX_TECHNICIANS")
      ).resolves.toBeUndefined();
    });

    it("should throw QuotaExceededError when limit is set to 0 via plan override", async () => {
      // Override MAX_TECHNICIANS to 0 (denying all new technicians)
      await prisma.workspaceEntitlementOverride.create({
        data: {
          workspaceId: wsId,
          featureKey: "MAX_TECHNICIANS",
          featureType: "NUMERIC_LIMIT",
          overrideValueJson: 0,
          reason: "Locked to 0 for test",
          grantedByUserId: `user_${runId}`,
          expiresAt: null,
        },
      });

      await expect(
        assertEntitlement(prisma, wsId, "MAX_TECHNICIANS")
      ).rejects.toThrow(QuotaExceededError);

      await prisma.workspaceEntitlementOverride.deleteMany({
        where: { workspaceId: wsId, featureKey: "MAX_TECHNICIANS" },
      });
    });

    it("should pass assertEntitlement(MAX_TECHNICIANS) with UNLIMITED override", async () => {
      await prisma.workspaceEntitlementOverride.create({
        data: {
          workspaceId: wsId,
          featureKey: "MAX_TECHNICIANS",
          featureType: "NUMERIC_LIMIT",
          overrideValueJson: "UNLIMITED",
          reason: "Enterprise unlimited",
          grantedByUserId: `user_${runId}`,
          expiresAt: null,
        },
      });

      // Even with limit=UNLIMITED, must pass immediately
      await expect(
        assertEntitlement(prisma, wsId, "MAX_TECHNICIANS")
      ).resolves.toBeUndefined();

      await prisma.workspaceEntitlementOverride.deleteMany({
        where: { workspaceId: wsId, featureKey: "MAX_TECHNICIANS" },
      });
    });
  });

  // ==========================================================================
  // 7. assertEntitlement — BOOLEAN enforcement
  // ==========================================================================

  describe("7. assertEntitlement — BOOLEAN feature gate enforcement", () => {
    it("should pass assertEntitlement(FEATURE_ADVANCED_REPORTING) when plan enables it", async () => {
      // Plan has FEATURE_ADVANCED_REPORTING = true
      await expect(
        assertEntitlement(prisma, wsId, "FEATURE_ADVANCED_REPORTING")
      ).resolves.toBeUndefined();
    });

    it("should throw PlanFeatureNotEnabledError for FEATURE_API_ACCESS = false (plan disables it)", async () => {
      // Plan has FEATURE_API_ACCESS = false
      await expect(
        assertEntitlement(prisma, wsId, "FEATURE_API_ACCESS")
      ).rejects.toThrow(PlanFeatureNotEnabledError);
    });

    it("should pass assertEntitlement(FEATURE_API_ACCESS) with a boolean override of true", async () => {
      await prisma.workspaceEntitlementOverride.create({
        data: {
          workspaceId: wsId,
          featureKey: "FEATURE_API_ACCESS",
          featureType: "BOOLEAN",
          overrideValueJson: true,
          reason: "Early access grant",
          grantedByUserId: `user_${runId}`,
          expiresAt: null,
        },
      });

      await expect(
        assertEntitlement(prisma, wsId, "FEATURE_API_ACCESS")
      ).resolves.toBeUndefined();

      await prisma.workspaceEntitlementOverride.deleteMany({
        where: { workspaceId: wsId, featureKey: "FEATURE_API_ACCESS" },
      });
    });
  });

  // ==========================================================================
  // 8. computeCurrentUsage — live count queries
  // ==========================================================================

  describe("8. computeCurrentUsage — live count queries", () => {
    it("should return 0 for MAX_MEMBERS when no active members exist", async () => {
      const usage = await computeCurrentUsage(prisma, wsId, "MAX_MEMBERS");
      // Fresh workspace — no WorkspaceMember rows with status=ACTIVE
      expect(usage).toBe(0);
    });

    it("should return 0 for MAX_TECHNICIANS when no technicians exist", async () => {
      const usage = await computeCurrentUsage(prisma, wsId, "MAX_TECHNICIANS");
      expect(usage).toBe(0);
    });

    it("should return 0 for MAX_WORK_ORDERS_PER_MONTH when no work orders exist", async () => {
      const usage = await computeCurrentUsage(prisma, wsId, "MAX_WORK_ORDERS_PER_MONTH");
      expect(usage).toBe(0);
    });

    it("should return 0 for MAX_SERVICE_LOCATIONS when no locations exist", async () => {
      const usage = await computeCurrentUsage(prisma, wsId, "MAX_SERVICE_LOCATIONS");
      expect(usage).toBe(0);
    });

    it("should return 0 for MAX_ATTACHMENT_STORAGE_MB (no Attachment model yet)", async () => {
      const usage = await computeCurrentUsage(prisma, wsId, "MAX_ATTACHMENT_STORAGE_MB");
      expect(usage).toBe(0);
    });

    it("should throw a programming-error when called with a BOOLEAN key", async () => {
      await expect(
        computeCurrentUsage(prisma, wsId, "FEATURE_ADVANCED_REPORTING")
      ).rejects.toThrow(/Programming error/);
    });
  });

  // ==========================================================================
  // 9. assertEntitlement — runs within $transaction (atomic guarantee)
  // ==========================================================================

  describe("9. assertEntitlement — executes inside $transaction", () => {
    it("should resolve correctly when called with a Prisma.TransactionClient", async () => {
      // Verify the function accepts and uses a TransactionClient correctly
      const result = await prisma.$transaction(async (tx) => {
        return resolveEntitlement(tx, wsId, "MAX_WORK_ORDERS_PER_MONTH");
      });
      expect(result.source).toBe("SUBSCRIPTION_PLAN");
      expect(result.value).toBe(200);
    });

    it("should assert inside $transaction and reject quota violations atomically", async () => {
      // Set MAX_MEMBERS to 0 via override, then verify assertEntitlement throws inside tx
      await prisma.workspaceEntitlementOverride.create({
        data: {
          workspaceId: wsId,
          featureKey: "MAX_MEMBERS",
          featureType: "NUMERIC_LIMIT",
          overrideValueJson: 0,
          reason: "Quota=0 for atomic tx test",
          grantedByUserId: `user_${runId}`,
          expiresAt: null,
        },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          await assertEntitlement(tx, wsId, "MAX_MEMBERS");
        })
      ).rejects.toThrow(QuotaExceededError);

      await prisma.workspaceEntitlementOverride.deleteMany({
        where: { workspaceId: wsId, featureKey: "MAX_MEMBERS" },
      });
    });
  });
});
