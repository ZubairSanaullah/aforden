/**
 * Phase 1.15.6 — Plan Change & Upgrade/Downgrade Service
 *
 * Coordinates immediate plan switches, seat expansions, and downgrades for
 * existing active subscriptions per §7.1 and §7.2 of Phase 1.15 Domain Architecture.
 * Synchronizes modifications with the provider gateway and records audit history.
 */

import type { PrismaClient, Prisma, Subscription } from "@/generated/prisma/client";
import { SubscriptionStatus } from "@/generated/prisma/enums";
import { getBillingAdapter } from "./providers/getBillingAdapter";
import {
  PlanPriceNotFoundError,
  SubscriptionNotFoundError,
  InvalidSubscriptionStatusForPlanChangeError,
  DowngradeUsageExceededError,
} from "./billingErrors";
import { NON_TERMINAL_SUBSCRIPTION_STATUSES } from "./subscriptionStateMachine";
import { isEntitlementKey } from "./entitlementRegistry";
import { computeCurrentUsage } from "./usageComputation";
import type { ChangePlanInput } from "@/lib/validations/billing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbClient = PrismaClient | Prisma.TransactionClient;

// Valid entry statuses for self-serve plan modification
const VALID_PLAN_CHANGE_STATUSES = new Set<SubscriptionStatus>([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
]);

// ---------------------------------------------------------------------------
// changeSubscriptionPlan
// ---------------------------------------------------------------------------

/**
 * Executes a plan upgrade, downgrade, or seat adjustment for an existing subscription.
 *
 * Requirements:
 *   1. Target workspace must possess an active/trialing subscription.
 *   2. Rejects plan changes if subscription is in delinquent (PAST_DUE, UNPAID),
 *      paused (PAUSED), or terminal (CANCELED, INCOMPLETE_EXPIRED) status.
 *   3. Target price and its plan must exist and be active.
 *   4. Validates that current workspace usage does not violate the target plan limits
 *      (preventing invalid downgrades where active resources exceed the new quota).
 *   5. Calls provider adapter to update subscription price and seat count.
 *   6. Atomically updates the local Subscription record and appends a SubscriptionHistory entry.
 *
 * @param prisma      - PrismaClient or Prisma.TransactionClient
 * @param workspaceId - Target tenant workspace
 * @param input       - Validated plan change input (priceId, seatsCount)
 * @param actorUserId - User initiating the plan change
 */
export async function changeSubscriptionPlan(
  prisma: DbClient,
  workspaceId: string,
  input: ChangePlanInput,
  actorUserId: string
): Promise<Subscription> {
  const db = prisma as PrismaClient;

  // 1. Locate current non-terminal subscription
  const currentSub = await db.subscription.findFirst({
    where: {
      workspaceId,
      status: { in: Array.from(NON_TERMINAL_SUBSCRIPTION_STATUSES) },
    },
    include: {
      account: true,
      plan: {
        include: {
          prices: true,
          features: true,
        },
      },
    },
  });

  if (!currentSub) {
    throw new SubscriptionNotFoundError(workspaceId);
  }

  // 2. Validate entry status
  if (!VALID_PLAN_CHANGE_STATUSES.has(currentSub.status)) {
    if (
      currentSub.status === SubscriptionStatus.PAST_DUE ||
      currentSub.status === SubscriptionStatus.UNPAID
    ) {
      throw new InvalidSubscriptionStatusForPlanChangeError(
        currentSub.status,
        "Cannot modify plan while subscription has past-due or unpaid balances. Settle outstanding invoices before changing plans."
      );
    }
    if (currentSub.status === SubscriptionStatus.PAUSED) {
      throw new InvalidSubscriptionStatusForPlanChangeError(
        currentSub.status,
        "Cannot modify plan while subscription is paused. Resume subscription before changing plans."
      );
    }
    throw new InvalidSubscriptionStatusForPlanChangeError(currentSub.status);
  }

  // 3. Resolve target SubscriptionPlanPrice & Plan
  const targetPrice = await db.subscriptionPlanPrice.findUnique({
    where: { id: input.priceId },
    include: {
      plan: {
        include: {
          features: true,
        },
      },
    },
  });

  if (!targetPrice || !targetPrice.isActive || !targetPrice.plan.isActive) {
    throw new PlanPriceNotFoundError(input.priceId);
  }

  // 4. Determine target seats count
  const targetSeats =
    input.seatsCount !== undefined
      ? input.seatsCount
      : Math.max(currentSub.seatsCount, targetPrice.plan.baseSeats);

  if (targetSeats < targetPrice.plan.baseSeats) {
    throw new Error(
      `Seats count (${targetSeats}) cannot be less than plan base seats (${targetPrice.plan.baseSeats})`
    );
  }

  // 5. Downgrade Quota Safety Guard
  // Verify that active resource consumption does not exceed the target plan limits
  for (const feature of targetPrice.plan.features) {
    if (feature.featureType === "NUMERIC_LIMIT") {
      const rawVal = feature.valueJson;
      if (rawVal === "UNLIMITED") continue;

      let targetLimit = Number(rawVal);
      if (feature.scalesWithSeats) {
        targetLimit = targetLimit * targetSeats;
      }

      if (
        isEntitlementKey(feature.featureKey) &&
        (feature.featureKey === "MAX_MEMBERS" ||
          feature.featureKey === "MAX_TECHNICIANS" ||
          feature.featureKey === "MAX_SERVICE_LOCATIONS")
      ) {
        const currentUsage = await computeCurrentUsage(
          prisma,
          workspaceId,
          feature.featureKey
        );

        if (currentUsage > targetLimit) {
          throw new DowngradeUsageExceededError(
            feature.featureKey,
            currentUsage,
            targetLimit
          );
        }
      }
    }
  }

  // 6. Resolve actual prior price ID for precise audit logging
  let oldPriceId: string | null = null;
  let oldBillingInterval: string | null = null;

  // 6a. Attempt to resolve from the most recent SubscriptionHistory entry
  const lastHistory = await db.subscriptionHistory.findFirst({
    where: { subscriptionId: currentSub.id },
    orderBy: { createdAt: "desc" },
    select: { metadataJson: true },
  });

  const lastMeta = lastHistory?.metadataJson as Record<string, unknown> | null;
  if (lastMeta?.newPriceId && typeof lastMeta.newPriceId === "string") {
    oldPriceId = lastMeta.newPriceId;
    if (typeof lastMeta.billingInterval === "string") {
      oldBillingInterval = lastMeta.billingInterval;
    }
  }

  // 6b. If not found in history, attempt matching providerPriceId from gateway
  if (!oldPriceId && currentSub.providerSubscriptionId) {
    try {
      const adapter = getBillingAdapter(currentSub.account.provider);
      const providerState = await adapter.fetchSubscription(currentSub.providerSubscriptionId);
      if (providerState?.providerPriceId) {
        const matchedPrice = currentSub.plan.prices.find(
          (p) =>
            p.providerPriceId === providerState.providerPriceId ||
            p.id === providerState.providerPriceId
        );
        if (matchedPrice) {
          oldPriceId = matchedPrice.id;
          oldBillingInterval = matchedPrice.billingInterval;
        }
      }
    } catch {
      // Gateway retrieval failed or provider offline in test
    }
  }

  // 6c. If still not resolved and the plan has exactly one unambiguous price
  if (!oldPriceId && currentSub.plan.prices.length === 1) {
    oldPriceId = currentSub.plan.prices[0].id;
    oldBillingInterval = currentSub.plan.prices[0].billingInterval;
  }

  // 7. Provider Gateway synchronization
  if (currentSub.providerSubscriptionId) {
    const adapter = getBillingAdapter(currentSub.account.provider);
    await adapter.updateSubscription({
      providerSubscriptionId: currentSub.providerSubscriptionId,
      providerPriceId: targetPrice.providerPriceId || targetPrice.id,
      seatsCount: targetSeats,
      metadata: {
        workspaceId,
        accountId: currentSub.accountId,
        planId: targetPrice.planId,
        priceId: targetPrice.id,
        seatsCount: String(targetSeats),
      },
    });
  }

  // 8. Atomic database update and SubscriptionHistory recording
  const runTx =
    typeof prisma.$transaction === "function"
      ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
      : async (cb: (tx: any) => Promise<any>) => cb(prisma);

  const updatedSubscription = await runTx(async (tx) => {
    const updated = await tx.subscription.update({
      where: { id: currentSub.id },
      data: {
        planId: targetPrice.planId,
        seatsCount: targetSeats,
      },
      include: {
        plan: true,
        account: true,
      },
    });

    await tx.subscriptionHistory.create({
      data: {
        subscriptionId: currentSub.id,
        fromStatus: currentSub.status,
        toStatus: currentSub.status,
        triggerSource: "USER_ACTION:change_plan",
        actorUserId,
        metadataJson: {
          oldPlanId: currentSub.planId,
          newPlanId: targetPrice.planId,
          oldSeatsCount: currentSub.seatsCount,
          newSeatsCount: targetSeats,
          oldPriceId,
          newPriceId: targetPrice.id,
          billingInterval: targetPrice.billingInterval,
          previousBillingInterval: oldBillingInterval,
        },
      },
    });

    return updated;
  });

  return updatedSubscription;
}
