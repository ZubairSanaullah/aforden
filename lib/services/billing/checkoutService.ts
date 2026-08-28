/**
 * Phase 1.15.6 — Checkout Session Creation Service
 *
 * Coordinates provider-hosted checkout session creation for workspaces starting
 * a new subscription. Strictly enforces the Single Active Subscription Invariant (§3.2):
 * rejects checkout creation if a non-terminal subscription already exists.
 */

import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { BillingProviderType } from "@/generated/prisma/enums";
import { getBillingAdapter } from "./providers/getBillingAdapter";
import type { CheckoutSessionResult } from "./providers/providerTypes";
import {
  DuplicateActiveSubscriptionError,
  PlanPriceNotFoundError,
} from "./billingErrors";
import { NON_TERMINAL_SUBSCRIPTION_STATUSES } from "./subscriptionStateMachine";
import type { CreateCheckoutInput } from "@/lib/validations/billing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface CheckoutOptions {
  customerEmail?: string;
  customerName?: string | null;
  provider?: BillingProviderType;
}

// ---------------------------------------------------------------------------
// createCheckoutSession
// ---------------------------------------------------------------------------

/**
 * Creates a provider-hosted checkout session URL for starting a new subscription.
 *
 * Invariant Enforcement:
 *   - Verifies the target workspace exists.
 *   - Checks that the workspace has NO non-terminal subscription (TRIALING, ACTIVE,
 *     PAST_DUE, UNPAID, INCOMPLETE, PAUSED). If one exists, throws DuplicateActiveSubscriptionError.
 *   - Verifies that the target price and its parent plan exist and are active.
 *   - Ensures a PlatformBillingAccount exists for the workspace and has a registered
 *     provider customer ID with the gateway adapter.
 *
 * @param prisma      - PrismaClient or Prisma.TransactionClient
 * @param workspaceId - Target tenant workspace
 * @param input       - Validated checkout input payload
 * @param options     - Optional customer email/name/provider overrides
 */
export async function createCheckoutSession(
  prisma: DbClient,
  workspaceId: string,
  input: CreateCheckoutInput,
  options?: CheckoutOptions
): Promise<CheckoutSessionResult> {
  const db = prisma as PrismaClient;

  // 1. Verify workspace exists
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true },
  });

  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' not found`);
  }

  // 2. Enforce Single Active Subscription Invariant (§3.2)
  const existingActiveSub = await db.subscription.findFirst({
    where: {
      workspaceId,
      status: { in: Array.from(NON_TERMINAL_SUBSCRIPTION_STATUSES) },
    },
    select: { id: true, accountId: true, status: true },
  });

  if (existingActiveSub) {
    throw new DuplicateActiveSubscriptionError(
      existingActiveSub.accountId,
      existingActiveSub.id
    );
  }

  // 3. Resolve target SubscriptionPlanPrice & SubscriptionPlan
  const planPrice = await db.subscriptionPlanPrice.findUnique({
    where: { id: input.priceId },
    include: {
      plan: true,
    },
  });

  if (!planPrice || !planPrice.isActive || !planPrice.plan.isActive) {
    throw new PlanPriceNotFoundError(input.priceId);
  }

  // 4. Find or create PlatformBillingAccount for workspace
  let billingAccount = await db.platformBillingAccount.findUnique({
    where: { workspaceId },
  });

  if (!billingAccount) {
    const billingEmail =
      options?.customerEmail?.trim() || `${workspaceId}@billing.aforden.internal`;
    const billingName = options?.customerName?.trim() || workspace.name;
    const provider: BillingProviderType =
      options?.provider ||
      (process.env.BILLING_PROVIDER === "MOCK" || !process.env.STRIPE_SECRET_KEY
        ? BillingProviderType.MOCK
        : BillingProviderType.STRIPE);

    billingAccount = await db.platformBillingAccount.create({
      data: {
        workspaceId,
        billingEmail,
        billingName,
        provider,
      },
    });
  }

  // 5. Obtain BillingProviderAdapter for the account's provider
  const adapter = getBillingAdapter(billingAccount.provider);

  // 6. Ensure provider customer exists on the gateway
  if (!billingAccount.providerCustomerId) {
    const customerResult = await adapter.createCustomer({
      workspaceId,
      email: billingAccount.billingEmail,
      name: billingAccount.billingName,
      metadata: { workspaceId },
    });

    billingAccount = await db.platformBillingAccount.update({
      where: { id: billingAccount.id },
      data: {
        providerCustomerId: customerResult.providerCustomerId,
      },
    });
  }

  // 7. Determine seats quantity (defaults to plan.baseSeats or input quantity)
  const quantity = input.quantity ?? planPrice.plan.baseSeats;

  // 8. Generate Provider Checkout Session
  const sessionResult = await adapter.createCheckoutSession({
    workspaceId,
    providerCustomerId: billingAccount.providerCustomerId,
    customerEmail: billingAccount.billingEmail,
    providerPriceId: planPrice.providerPriceId || planPrice.id,
    quantity,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    trialPeriodDays: input.trialPeriodDays ?? null,
    metadata: {
      workspaceId,
      accountId: billingAccount.id,
      planId: planPrice.planId,
      priceId: planPrice.id,
      seatsCount: String(quantity),
    },
  });

  return sessionResult;
}
