import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../../generated/prisma/client";
import { seedSubscriptionPlans } from "@/lib/services/billing/seedSubscriptionPlans";

describe("Phase 1.15.2 — SaaS Billing Database Schema, Constraints & FK Integrity Tests", () => {
  let prisma: PrismaClient;
  const testRunId = `bill_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_${testRunId}`;
  const planCode = `plan_${testRunId}`;
  let planId: string;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // Seed base plans
    await seedSubscriptionPlans(prisma);

    // Create test workspace
    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Billing Test Workspace ${testRunId}`,
        slug: `test-bill-ws-${testRunId}`,
      },
    });

    // Create a dedicated test plan for referential tests
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code: planCode,
        name: `Test Plan ${testRunId}`,
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

  describe("1. Partial Unique Index: Single Active Subscription Invariant (§3.2)", () => {
    it("should reject a second non-terminal subscription for the same accountId at DB level", async () => {
      const accountId = `acc_active_test_${testRunId}`;

      // Create billing account
      await prisma.platformBillingAccount.create({
        data: {
          id: accountId,
          workspaceId: wsId,
          billingEmail: `billing-${testRunId}@example.com`,
          provider: "STRIPE",
          providerCustomerId: `cus_active_${testRunId}`,
        },
      });

      // 1. Create first ACTIVE subscription
      const sub1 = await prisma.subscription.create({
        data: {
          id: `sub_1_${testRunId}`,
          workspaceId: wsId,
          accountId,
          planId,
          status: "ACTIVE",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
          seatsCount: 1,
        },
      });
      expect(sub1.id).toBeDefined();

      // 2. Attempt to create second subscription with non-terminal status (TRIALING) for same accountId
      await expect(
        prisma.subscription.create({
          data: {
            id: `sub_2_${testRunId}`,
            workspaceId: wsId,
            accountId,
            planId,
            status: "TRIALING",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 14 * 86400000),
            seatsCount: 1,
          },
        })
      ).rejects.toThrow();
    });

    it("should allow a new subscription when existing subscription is in terminal status (CANCELED)", async () => {
      const accountId = `acc_terminal_test_${testRunId}`;
      const wsTerminalId = `ws_term_${testRunId}`;

      await prisma.workspace.create({
        data: {
          id: wsTerminalId,
          name: `Terminal Sub WS ${testRunId}`,
          slug: `test-term-ws-${testRunId}`,
        },
      });

      await prisma.platformBillingAccount.create({
        data: {
          id: accountId,
          workspaceId: wsTerminalId,
          billingEmail: `term-${testRunId}@example.com`,
          provider: "STRIPE",
          providerCustomerId: `cus_term_${testRunId}`,
        },
      });

      // 1. Create CANCELED subscription (terminal status)
      const subCanceled = await prisma.subscription.create({
        data: {
          id: `sub_canceled_${testRunId}`,
          workspaceId: wsTerminalId,
          accountId,
          planId,
          status: "CANCELED",
          currentPeriodStart: new Date(Date.now() - 60 * 86400000),
          currentPeriodEnd: new Date(Date.now() - 30 * 86400000),
          endedAt: new Date(Date.now() - 30 * 86400000),
          seatsCount: 1,
        },
      });
      expect(subcanceled_valid(subCanceled)).toBe(true);

      // 2. Creating a new ACTIVE subscription for the same accountId MUST succeed
      const subNewActive = await prisma.subscription.create({
        data: {
          id: `sub_new_active_${testRunId}`,
          workspaceId: wsTerminalId,
          accountId,
          planId,
          status: "ACTIVE",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
          seatsCount: 2,
        },
      });
      expect(subNewActive.id).toBeDefined();
      expect(subNewActive.status).toBe("ACTIVE");

      // Cleanup
      await prisma.workspace.delete({ where: { id: wsTerminalId } });
    });
  });

  describe("2. Foreign Key Cascade and Restrict Rules", () => {
    it("should restrict deletion of SubscriptionPlan when referenced by an active Subscription", async () => {
      // planId is referenced by sub1 in accountId
      await expect(
        prisma.subscriptionPlan.delete({
          where: { id: planId },
        })
      ).rejects.toThrow();
    });

    it("should setNull on SubscriptionInvoice.subscriptionId when Subscription is deleted", async () => {
      const wsCascadeId = `ws_casc_${testRunId}`;
      const accCascadeId = `acc_casc_${testRunId}`;
      const subCascadeId = `sub_casc_${testRunId}`;
      const invCascadeId = `inv_casc_${testRunId}`;

      await prisma.workspace.create({
        data: {
          id: wsCascadeId,
          name: `Cascade WS ${testRunId}`,
          slug: `test-casc-ws-${testRunId}`,
        },
      });

      await prisma.platformBillingAccount.create({
        data: {
          id: accCascadeId,
          workspaceId: wsCascadeId,
          billingEmail: `casc-${testRunId}@example.com`,
        },
      });

      await prisma.subscription.create({
        data: {
          id: subCascadeId,
          workspaceId: wsCascadeId,
          accountId: accCascadeId,
          planId,
          status: "ACTIVE",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        },
      });

      await prisma.subscriptionInvoice.create({
        data: {
          id: invCascadeId,
          workspaceId: wsCascadeId,
          accountId: accCascadeId,
          subscriptionId: subCascadeId,
          status: "PAID",
          amountDueCents: 4900,
          amountPaidCents: 4900,
          subtotalCents: 4900,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 86400000),
        },
      });

      // Delete subscription
      await prisma.subscription.delete({ where: { id: subCascadeId } });

      // Invoice should still exist, with subscriptionId set to null
      const invoice = await prisma.subscriptionInvoice.findUnique({
        where: { id: invCascadeId },
      });
      expect(invoice).toBeDefined();
      expect(invoice?.subscriptionId).toBeNull();

      // Cleanup
      await prisma.workspace.delete({ where: { id: wsCascadeId } });
    });

    it("should cascade delete SubscriptionPayment when SubscriptionInvoice is deleted", async () => {
      const wsPayId = `ws_pay_${testRunId}`;
      const accPayId = `acc_pay_${testRunId}`;
      const invPayId = `inv_pay_${testRunId}`;
      const payId = `pay_${testRunId}`;

      await prisma.workspace.create({
        data: {
          id: wsPayId,
          name: `Payment Cascade WS ${testRunId}`,
          slug: `test-pay-ws-${testRunId}`,
        },
      });

      await prisma.platformBillingAccount.create({
        data: {
          id: accPayId,
          workspaceId: wsPayId,
          billingEmail: `pay-${testRunId}@example.com`,
        },
      });

      await prisma.subscriptionInvoice.create({
        data: {
          id: invPayId,
          workspaceId: wsPayId,
          accountId: accPayId,
          status: "PAID",
          amountDueCents: 4900,
          amountPaidCents: 4900,
          subtotalCents: 4900,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 86400000),
        },
      });

      await prisma.subscriptionPayment.create({
        data: {
          id: payId,
          workspaceId: wsPayId,
          invoiceId: invPayId,
          amountCents: 4900,
          status: "SUCCEEDED",
          paymentMethodBrand: "visa",
          paymentMethodLast4: "4242",
        },
      });

      // Delete invoice
      await prisma.subscriptionInvoice.delete({ where: { id: invPayId } });

      // Payment record should be cascade deleted
      const payment = await prisma.subscriptionPayment.findUnique({
        where: { id: payId },
      });
      expect(payment).toBeNull();

      // Cleanup
      await prisma.workspace.delete({ where: { id: wsPayId } });
    });

    it("should cascade delete all billing entities when Workspace is deleted", async () => {
      const wsFullId = `ws_full_${testRunId}`;
      const accFullId = `acc_full_${testRunId}`;
      const subFullId = `sub_full_${testRunId}`;
      const overrideId = `ovr_full_${testRunId}`;

      await prisma.workspace.create({
        data: {
          id: wsFullId,
          name: `Full Cascade WS ${testRunId}`,
          slug: `test-full-ws-${testRunId}`,
        },
      });

      await prisma.platformBillingAccount.create({
        data: {
          id: accFullId,
          workspaceId: wsFullId,
          billingEmail: `full-${testRunId}@example.com`,
        },
      });

      await prisma.subscription.create({
        data: {
          id: subFullId,
          workspaceId: wsFullId,
          accountId: accFullId,
          planId,
          status: "ACTIVE",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        },
      });

      await prisma.workspaceEntitlementOverride.create({
        data: {
          id: overrideId,
          workspaceId: wsFullId,
          featureKey: "MAX_MEMBERS",
          featureType: "NUMERIC_LIMIT",
          overrideValueJson: 50,
          reason: "Enterprise pilot agreement",
          grantedByUserId: "usr_admin",
        },
      });

      // Delete workspace
      await prisma.workspace.delete({ where: { id: wsFullId } });

      // Assert all child records are gone
      const account = await prisma.platformBillingAccount.findUnique({ where: { id: accFullId } });
      const subscription = await prisma.subscription.findUnique({ where: { id: subFullId } });
      const override = await prisma.workspaceEntitlementOverride.findUnique({ where: { id: overrideId } });

      expect(account).toBeNull();
      expect(subscription).toBeNull();
      expect(override).toBeNull();
    });
  });
});

function subcanceled_valid(sub: { id: string; status: string }) {
  return sub.id !== "" && sub.status === "CANCELED";
}
