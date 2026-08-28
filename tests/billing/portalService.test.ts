import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { SubscriptionStatus } from "../../generated/prisma/enums";
import { createCustomerPortalSession } from "@/lib/services/billing/portalService";
import {
  BillingAccountNotFoundError,
  MissingProviderCustomerError,
} from "@/lib/services/billing/billingErrors";

describe("Phase 1.15.7 — CustomerPortalService Integration Tests", () => {
  let prisma: PrismaClient;
  const runId = `portal_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsWithCustomer = `ws_cust_${runId}`;
  const wsWithoutCustomer = `ws_nocust_${runId}`;
  const wsNoAccount = `ws_noacc_${runId}`;
  const wsPastDue = `ws_pastdue_${runId}`;
  const planCode = `plan_portal_${runId}`;

  let planId: string;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Create plan for test subscriptions
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code: planCode,
        name: `Portal Plan ${runId}`,
        tier: "STARTER",
        baseSeats: 1,
      },
    });
    planId = plan.id;

    // 2. Create workspace with valid providerCustomerId
    await prisma.workspace.create({
      data: {
        id: wsWithCustomer,
        name: `Portal WS With Customer ${runId}`,
        slug: `portal-cust-${runId}`,
      },
    });

    await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsWithCustomer,
        billingEmail: `cust-${runId}@example.com`,
        provider: "MOCK",
        providerCustomerId: `cus_mock_valid_${runId}`,
      },
    });

    // 3. Create workspace with billing account but NO providerCustomerId
    await prisma.workspace.create({
      data: {
        id: wsWithoutCustomer,
        name: `Portal WS Without Customer ${runId}`,
        slug: `portal-nocust-${runId}`,
      },
    });

    await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsWithoutCustomer,
        billingEmail: `nocust-${runId}@example.com`,
        provider: "MOCK",
        providerCustomerId: null,
      },
    });

    // 4. Create workspace with NO billing account
    await prisma.workspace.create({
      data: {
        id: wsNoAccount,
        name: `Portal WS No Account ${runId}`,
        slug: `portal-noacc-${runId}`,
      },
    });

    // 5. Create workspace with PAST_DUE subscription
    await prisma.workspace.create({
      data: {
        id: wsPastDue,
        name: `Portal WS Past Due ${runId}`,
        slug: `portal-pastdue-${runId}`,
      },
    });

    const pastDueAccount = await prisma.platformBillingAccount.create({
      data: {
        workspaceId: wsPastDue,
        billingEmail: `pastdue-${runId}@example.com`,
        provider: "MOCK",
        providerCustomerId: `cus_mock_pastdue_${runId}`,
      },
    });

    await prisma.subscription.create({
      data: {
        workspaceId: wsPastDue,
        accountId: pastDueAccount.id,
        planId,
        status: SubscriptionStatus.PAST_DUE,
        providerSubscriptionId: `sub_pastdue_${runId}`,
        currentPeriodStart: new Date(Date.now() - 15 * 86400000),
        currentPeriodEnd: new Date(Date.now() + 15 * 86400000),
        gracePeriodEndsAt: new Date(Date.now() + 7 * 86400000),
        dunningAttemptsCount: 2,
        seatsCount: 1,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      try {
        await prisma.subscription.deleteMany({
          where: { workspaceId: wsPastDue },
        });
        await prisma.subscriptionPlan.deleteMany({
          where: { id: planId },
        });
        await prisma.platformBillingAccount.deleteMany({
          where: {
            workspaceId: {
              in: [wsWithCustomer, wsWithoutCustomer, wsNoAccount, wsPastDue],
            },
          },
        });
        await prisma.workspace.deleteMany({
          where: {
            id: {
              in: [wsWithCustomer, wsWithoutCustomer, wsNoAccount, wsPastDue],
            },
          },
        });
      } catch (err) {
        console.error("Cleanup error in portalService.test.ts:", err);
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  it("1. should successfully generate a customer portal session URL for a workspace with a providerCustomerId", async () => {
    const result = await createCustomerPortalSession(prisma, wsWithCustomer, {
      returnUrl: "https://aforden.com/settings/billing",
    });

    expect(result).toBeDefined();
    expect(result.portalUrl).toBe(`https://mock-billing.aforden.internal/portal/cus_mock_valid_${runId}`);
  });

  it("2. should allow portal session generation when subscription is in PAST_DUE status for payment method updates", async () => {
    const result = await createCustomerPortalSession(prisma, wsPastDue, {
      returnUrl: "https://aforden.com/settings/billing",
    });

    expect(result).toBeDefined();
    expect(result.portalUrl).toBe(`https://mock-billing.aforden.internal/portal/cus_mock_pastdue_${runId}`);
  });

  it("3. should throw MissingProviderCustomerError when billing account exists but providerCustomerId is missing", async () => {
    await expect(
      createCustomerPortalSession(prisma, wsWithoutCustomer, {
        returnUrl: "https://aforden.com/settings/billing",
      })
    ).rejects.toThrow(MissingProviderCustomerError);
  });

  it("4. should throw BillingAccountNotFoundError when workspace has no PlatformBillingAccount", async () => {
    await expect(
      createCustomerPortalSession(prisma, wsNoAccount, {
        returnUrl: "https://aforden.com/settings/billing",
      })
    ).rejects.toThrow(BillingAccountNotFoundError);
  });

  it("5. should throw an error if the workspace does not exist", async () => {
    await expect(
      createCustomerPortalSession(prisma, "non_existent_workspace_id", {
        returnUrl: "https://aforden.com/settings/billing",
      })
    ).rejects.toThrow("Workspace 'non_existent_workspace_id' not found");
  });
});
