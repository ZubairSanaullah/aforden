import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../../generated/prisma/client";
import { SubscriptionStatus } from "../../generated/prisma/enums";
import {
  createSubscription,
  transitionSubscriptionStatus,
  cancelSubscription,
  applyAdminOverride,
} from "@/lib/services/billing/subscriptionService";
import {
  DuplicateActiveSubscriptionError,
  InvalidSubscriptionStateTransitionError,
} from "@/lib/services/billing/billingErrors";
import { NON_TERMINAL_SUBSCRIPTION_STATUSES } from "@/lib/services/billing/subscriptionStateMachine";

describe("Phase 1.15.4 — SubscriptionService Lifecycle Engine Tests", () => {
  let prisma: PrismaClient;
  const testRunId = `subsvc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_${testRunId}`;
  const planCode = `plan_${testRunId}`;
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

    // Create workspace
    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Subscription Service Workspace ${testRunId}`,
        slug: `subsvc-${testRunId}`,
      },
    });

    // Create billing account
    const account = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsId,
        billingEmail: `billing-${testRunId}@example.com`,
        provider: "STRIPE",
        providerCustomerId: `cus_${testRunId}`,
      },
    });
    accountId = account.id;

    // Create subscription plan
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code: planCode,
        name: `Plan ${testRunId}`,
        tier: "STARTER",
        baseSeats: 1,
      },
    });
    planId = plan.id;
  });

  afterAll(async () => {
    if (prisma) {
      try {
        await prisma.workspace.deleteMany({ where: { id: wsId } });
        await prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
      } catch {
        // Ignore cleanup errors
      }
      await prisma.$disconnect();
    }
  });

  describe("1. createSubscription & Single Active Invariant (§3.2)", () => {
    it("should create an active subscription and record history entry", async () => {
      const start = new Date();
      const end = new Date(Date.now() + 30 * 86400000);

      const sub = await prisma.$transaction(async (tx) => {
        return createSubscription(tx, {
          workspaceId: wsId,
          accountId,
          planId,
          status: SubscriptionStatus.TRIALING,
          providerSubscriptionId: `sub_stripe_${testRunId}_1`,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          trialStart: start,
          trialEnd: new Date(Date.now() + 14 * 86400000),
          seatsCount: 3,
          triggerSource: "SYSTEM:signup",
        });
      });

      expect(sub.id).toBeDefined();
      expect(sub.status).toBe(SubscriptionStatus.TRIALING);
      expect(sub.seatsCount).toBe(3);
      activeSubId = sub.id;

      const history = await prisma.subscriptionHistory.findMany({
        where: { subscriptionId: sub.id },
      });
      expect(history.length).toBe(1);
      expect(history[0].fromStatus).toBeNull();
      expect(history[0].toStatus).toBe(SubscriptionStatus.TRIALING);
      expect(history[0].triggerSource).toBe("SYSTEM:signup");
    });

    it("should throw DuplicateActiveSubscriptionError via pre-check if a non-terminal subscription exists", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return createSubscription(tx, {
            workspaceId: wsId,
            accountId,
            planId,
            status: SubscriptionStatus.ACTIVE,
            providerSubscriptionId: `sub_stripe_${testRunId}_2`,
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
          });
        })
      ).rejects.toThrowError(DuplicateActiveSubscriptionError);
    });

    it("should catch P2002 unique constraint violation on race condition and throw DuplicateActiveSubscriptionError with conflicting ID", async () => {
      // Mock tx where findFirst returns null (simulating concurrent race) but create throws Prisma P2002
      const mockTx: any = {
        subscription: {
          findFirst: async (args: any) => {
            // If selecting ID (during catch handler), return existing ID
            if (args?.select?.id) {
              return { id: activeSubId };
            }
            // Pre-check returns null simulating race
            return null;
          },
          create: async () => {
            throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
              code: "P2002",
              clientVersion: "7.0.0",
            });
          },
        },
      };

      try {
        await createSubscription(mockTx, {
          workspaceId: wsId,
          accountId,
          planId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        });
        expect.unreachable("Should have thrown DuplicateActiveSubscriptionError");
      } catch (err: any) {
        expect(err).toBeInstanceOf(DuplicateActiveSubscriptionError);
        expect(err.code).toBe("DUPLICATE_ACTIVE_SUBSCRIPTION");
        expect(err.context.existingSubscriptionId).toBe(activeSubId);
      }
    });

    it("should allow a new subscription when existing subscription is in terminal status (CANCELED)", async () => {
      // Find the existing subscription and cancel it
      await prisma.subscription.update({
        where: { id: activeSubId },
        data: { status: SubscriptionStatus.CANCELED, endedAt: new Date() },
      });

      // Now create a new subscription
      const newSub = await prisma.$transaction(async (tx) => {
        return createSubscription(tx, {
          workspaceId: wsId,
          accountId,
          planId,
          status: SubscriptionStatus.ACTIVE,
          providerSubscriptionId: `sub_stripe_${testRunId}_reactivated`,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
          triggerSource: "CHECKOUT:session_completed",
        });
      });

      expect(newSub.id).toBeDefined();
      expect(newSub.status).toBe(SubscriptionStatus.ACTIVE);
      activeSubId = newSub.id;
    });
  });

  describe("2. transitionSubscriptionStatus Side Effects & Audit History (§4.2)", () => {
    it("should transition ACTIVE -> PAST_DUE and set 7-day grace period with incremented dunning counter", async () => {
      const result = await prisma.$transaction(async (tx) => {
        return transitionSubscriptionStatus(tx, {
          subscriptionId: activeSubId,
          toStatus: SubscriptionStatus.PAST_DUE,
          triggerSource: "WEBHOOK:invoice.payment_failed",
          metadataJson: { invoiceId: "in_mock_fail_1" },
        });
      });

      expect(result.outcome).toBe("APPLIED");
      if (result.outcome === "APPLIED") {
        expect(result.subscription.status).toBe(SubscriptionStatus.PAST_DUE);
        expect(result.subscription.gracePeriodEndsAt).not.toBeNull();
        expect(result.subscription.dunningAttemptsCount).toBe(1);

        const graceDurationMs =
          result.subscription.gracePeriodEndsAt!.getTime() - Date.now();
        expect(graceDurationMs).toBeGreaterThan(6 * 86400000);
        expect(graceDurationMs).toBeLessThanOrEqual(7.1 * 86400000);
      }

      const history = await prisma.subscriptionHistory.findFirst({
        where: { subscriptionId: activeSubId, toStatus: SubscriptionStatus.PAST_DUE },
      });
      expect(history).not.toBeNull();
      expect(history!.fromStatus).toBe(SubscriptionStatus.ACTIVE);
      expect(history!.triggerSource).toBe("WEBHOOK:invoice.payment_failed");
    });

    it("should transition PAST_DUE -> ACTIVE, clearing gracePeriodEndsAt and resetting dunningAttemptsCount", async () => {
      const result = await prisma.$transaction(async (tx) => {
        return transitionSubscriptionStatus(tx, {
          subscriptionId: activeSubId,
          toStatus: SubscriptionStatus.ACTIVE,
          triggerSource: "WEBHOOK:invoice.payment_succeeded",
          metadataJson: { invoiceId: "in_mock_recovered_1" },
        });
      });

      expect(result.outcome).toBe("APPLIED");
      if (result.outcome === "APPLIED") {
        expect(result.subscription.status).toBe(SubscriptionStatus.ACTIVE);
        expect(result.subscription.gracePeriodEndsAt).toBeNull();
        expect(result.subscription.dunningAttemptsCount).toBe(0);
      }

      const history = await prisma.subscriptionHistory.findFirst({
        where: { subscriptionId: activeSubId, toStatus: SubscriptionStatus.ACTIVE, fromStatus: SubscriptionStatus.PAST_DUE },
      });
      expect(history).not.toBeNull();
      expect(history!.triggerSource).toBe("WEBHOOK:invoice.payment_succeeded");
    });

    it("should allow TRIALING -> CANCELED via USER_ACTION:cancel and write history", async () => {
      // Create a dedicated workspace and billing account for this isolated trialing test
      const trialWs = await prisma.workspace.create({
        data: {
          id: `ws_trial_${testRunId}`,
          name: `Trial Workspace ${testRunId}`,
          slug: `trial-ws-${testRunId}`,
        },
      });

      const trialAccount = await prisma.platformBillingAccount.create({
        data: {
          workspaceId: trialWs.id,
          billingEmail: `trial-${testRunId}@example.com`,
          provider: "STRIPE",
          providerCustomerId: `cus_trial_${testRunId}`,
        },
      });

      const trialingSub = await prisma.subscription.create({
        data: {
          workspaceId: trialWs.id,
          accountId: trialAccount.id,
          planId,
          status: SubscriptionStatus.TRIALING,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 14 * 86400000),
          trialStart: new Date(),
          trialEnd: new Date(Date.now() + 14 * 86400000),
        },
      });

      const result = await prisma.$transaction(async (tx) => {
        return transitionSubscriptionStatus(tx, {
          subscriptionId: trialingSub.id,
          toStatus: SubscriptionStatus.CANCELED,
          triggerSource: "USER_ACTION:cancel",
          actorUserId: "usr_trial_canceler",
          metadataJson: { reason: "Not suitable for needs" },
        });
      });

      expect(result.outcome).toBe("APPLIED");
      if (result.outcome === "APPLIED") {
        expect(result.subscription.status).toBe(SubscriptionStatus.CANCELED);
        expect(result.subscription.canceledAt).not.toBeNull();
        expect(result.subscription.endedAt).not.toBeNull();
      }

      const history = await prisma.subscriptionHistory.findFirst({
        where: { subscriptionId: trialingSub.id, toStatus: SubscriptionStatus.CANCELED },
      });
      expect(history).not.toBeNull();
      expect(history!.fromStatus).toBe(SubscriptionStatus.TRIALING);
      expect(history!.triggerSource).toBe("USER_ACTION:cancel");
      expect(history!.actorUserId).toBe("usr_trial_canceler");

      // Cleanup
      await prisma.workspace.deleteMany({ where: { id: trialWs.id } });
    });

    it("should reject an illegal transition from ACTIVE -> INCOMPLETE", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return transitionSubscriptionStatus(tx, {
            subscriptionId: activeSubId,
            toStatus: SubscriptionStatus.INCOMPLETE,
            triggerSource: "WEBHOOK",
          });
        })
      ).rejects.toThrowError(InvalidSubscriptionStateTransitionError);
    });
  });

  describe("3. Out-of-Order Webhook Guard (§6.1)", () => {
    beforeAll(async () => {
      // Set baseline lastSyncedProviderEventAt timestamp
      await prisma.subscription.update({
        where: { id: activeSubId },
        data: {
          lastSyncedProviderEventAt: new Date(1700000000 * 1000), // Base timestamp
        },
      });
    });

    it("should reject an out-of-order stale webhook and return outcome: IGNORED_OUT_OF_ORDER", async () => {
      const staleTimestamp = new Date(1699900000 * 1000); // 100,000s earlier

      const result = await prisma.$transaction(async (tx) => {
        return transitionSubscriptionStatus(tx, {
          subscriptionId: activeSubId,
          toStatus: SubscriptionStatus.PAST_DUE,
          triggerSource: "WEBHOOK:invoice.payment_failed",
          providerEventTimestamp: staleTimestamp,
        });
      });

      expect(result.outcome).toBe("IGNORED_OUT_OF_ORDER");
      if (result.outcome === "IGNORED_OUT_OF_ORDER") {
        expect(result.subscription.status).toBe(SubscriptionStatus.ACTIVE); // State was not changed
        expect(result.reason).toContain("older than last synced");
      }

      const subAfter = await prisma.subscription.findUnique({ where: { id: activeSubId } });
      expect(subAfter!.status).toBe(SubscriptionStatus.ACTIVE);
    });

    it("should accept a newer webhook timestamp and advance lastSyncedProviderEventAt", async () => {
      const newerTimestamp = new Date(1700100000 * 1000);

      const result = await prisma.$transaction(async (tx) => {
        return transitionSubscriptionStatus(tx, {
          subscriptionId: activeSubId,
          toStatus: SubscriptionStatus.PAST_DUE,
          triggerSource: "WEBHOOK:invoice.payment_failed",
          providerEventTimestamp: newerTimestamp,
        });
      });

      expect(result.outcome).toBe("APPLIED");
      if (result.outcome === "APPLIED") {
        expect(result.subscription.status).toBe(SubscriptionStatus.PAST_DUE);
        expect(result.subscription.lastSyncedProviderEventAt?.getTime()).toBe(newerTimestamp.getTime());
      }
    });
  });

  describe("4. Idempotent Same-State Webhook Replay", () => {
    it("should safely return NOOP_SAME_STATE when receiving replayed webhook for current status", async () => {
      const subBefore = await prisma.subscription.findUnique({ where: { id: activeSubId } });
      const currentStatus = subBefore!.status;

      const result = await prisma.$transaction(async (tx) => {
        return transitionSubscriptionStatus(tx, {
          subscriptionId: activeSubId,
          toStatus: currentStatus,
          triggerSource: "WEBHOOK:invoice.payment_failed",
        });
      });

      expect(result.outcome).toBe("NOOP_SAME_STATE");
      expect(result.subscription.status).toBe(currentStatus);
    });
  });

  describe("5. cancelSubscription (§7.2)", () => {
    beforeAll(async () => {
      // Transition subscription back to ACTIVE status cleanly
      await prisma.subscription.update({
        where: { id: activeSubId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          endedAt: null,
          gracePeriodEndsAt: null,
          dunningAttemptsCount: 0,
        },
      });
    });

    it("should set cancelAtPeriodEnd=true without changing status when immediately=false", async () => {
      const result = await prisma.$transaction(async (tx) => {
        return cancelSubscription(tx, {
          subscriptionId: activeSubId,
          immediately: false,
          actorUserId: "usr_owner_123",
          reason: "Switching tools at end of billing cycle",
        });
      });

      expect(result.outcome).toBe("APPLIED");
      if (result.outcome === "APPLIED") {
        expect(result.subscription.status).toBe(SubscriptionStatus.ACTIVE);
        expect(result.subscription.cancelAtPeriodEnd).toBe(true);
      }

      const history = await prisma.subscriptionHistory.findFirst({
        where: { subscriptionId: activeSubId, triggerSource: "USER_ACTION:cancel_at_period_end" },
      });
      expect(history).not.toBeNull();
      expect(history!.actorUserId).toBe("usr_owner_123");
    });

    it("should transition status directly to CANCELED when immediately=true", async () => {
      const result = await prisma.$transaction(async (tx) => {
        return cancelSubscription(tx, {
          subscriptionId: activeSubId,
          immediately: true,
          actorUserId: "usr_owner_123",
          reason: "Shutting down business immediately",
        });
      });

      expect(result.outcome).toBe("APPLIED");
      if (result.outcome === "APPLIED") {
        expect(result.subscription.status).toBe(SubscriptionStatus.CANCELED);
        expect(result.subscription.canceledAt).not.toBeNull();
        expect(result.subscription.endedAt).not.toBeNull();
      }

      const history = await prisma.subscriptionHistory.findFirst({
        where: { subscriptionId: activeSubId, toStatus: SubscriptionStatus.CANCELED },
      });
      expect(history).not.toBeNull();
      expect(history!.actorUserId).toBe("usr_owner_123");
    });

    it("should reject cancelSubscription if actorUserId is missing", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return cancelSubscription(tx, {
            subscriptionId: activeSubId,
            immediately: true,
            actorUserId: "",
          });
        })
      ).rejects.toThrow("Subscription cancellation requires a valid actorUserId");
    });
  });

  describe("6. applyAdminOverride (§4.2)", () => {
    let overrideSubId: string;

    beforeAll(async () => {
      // Create a fresh subscription for admin override testing
      const sub = await prisma.subscription.create({
        data: {
          workspaceId: wsId,
          accountId,
          planId,
          status: SubscriptionStatus.ACTIVE,
          providerSubscriptionId: `sub_stripe_${testRunId}_override`,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
          seatsCount: 1,
        },
      });
      overrideSubId = sub.id;
    });

    it("should successfully apply ADMIN_OVERRIDE from ACTIVE -> PAUSED", async () => {
      const result = await prisma.$transaction(async (tx) => {
        return applyAdminOverride(tx, {
          subscriptionId: overrideSubId,
          toStatus: SubscriptionStatus.PAUSED,
          actorUserId: "usr_admin_master",
          reason: "Customer support billing investigation hold",
          metadataJson: { ticketId: "CS-8899" },
        });
      });

      expect(result.outcome).toBe("APPLIED");
      if (result.outcome === "APPLIED") {
        expect(result.subscription.status).toBe(SubscriptionStatus.PAUSED);
      }

      const history = await prisma.subscriptionHistory.findFirst({
        where: { subscriptionId: overrideSubId, triggerSource: "ADMIN_OVERRIDE" },
      });
      expect(history).not.toBeNull();
      expect(history!.actorUserId).toBe("usr_admin_master");
      expect((history!.metadataJson as any)?.reason).toBe(
        "Customer support billing investigation hold"
      );
      expect((history!.metadataJson as any)?.ticketId).toBe("CS-8899");
    });

    it("should reject applyAdminOverride if reason is empty", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return applyAdminOverride(tx, {
            subscriptionId: overrideSubId,
            toStatus: SubscriptionStatus.ACTIVE,
            actorUserId: "usr_admin_master",
            reason: "   ",
          });
        })
      ).rejects.toThrow("Admin override requires a non-empty explanation reason");
    });

    it("should reject applyAdminOverride if actorUserId is missing", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return applyAdminOverride(tx, {
            subscriptionId: overrideSubId,
            toStatus: SubscriptionStatus.ACTIVE,
            actorUserId: "",
            reason: "Legitimate reason",
          });
        })
      ).rejects.toThrow("Admin override requires a valid actorUserId");
    });
  });
});
