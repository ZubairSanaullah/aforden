/**
 * Phase 1.15.9 — Dunning Engine & Grace Periods Service
 *
 * Implements:
 * 1. Dunning scheduler and sweep worker for PAST_DUE subscriptions per §8.1.
 * 2. Grace period expiration handling (PAST_DUE -> UNPAID).
 * 3. Unpaid retention automatic termination (UNPAID -> CANCELED).
 * 4. Trial period expiration handling (TRIALING -> PAST_DUE).
 * 5. Idempotent evaluation and boundary condition management.
 */

import { PrismaClient, Prisma, Subscription } from "@/generated/prisma/client";
import { SubscriptionStatus } from "@/generated/prisma/enums";
import { SubscriptionNotFoundError } from "./billingErrors";
import { transitionSubscriptionStatus } from "./subscriptionService";

// ---------------------------------------------------------------------------
// Interfaces & Types
// ---------------------------------------------------------------------------

export interface DunningSweepOptions {
  workspaceId?: string;
  workspaceIds?: string[];
  referenceDate?: Date;
  batchSize?: number;
  unpaidRetentionDays?: number;
  actorUserId?: string | null;
}

export interface DunningSweepResult {
  processedPastDueCount: number;
  transitionedToUnpaidCount: number;
  transitionedToCanceledCount: number;
  transitionedTrialExpiredCount: number;
  errors: Array<{ subscriptionId: string; error: string }>;
}

export type DunningAction =
  | "ACTIVE_GRACE_PERIOD"
  | "TRANSITIONED_TO_UNPAID"
  | "TRANSITIONED_TO_CANCELED"
  | "TRANSITIONED_TO_PAST_DUE"
  | "ACTIVE_TRIAL"
  | "UNPAID_PENDING_TERMINATION"
  | "NOOP";

export interface DunningAttemptOptions {
  referenceDate?: Date;
  unpaidRetentionDays?: number;
  actorUserId?: string | null;
}

export interface DunningAttemptResult {
  subscriptionId: string;
  status: SubscriptionStatus;
  actionTaken: DunningAction;
  remainingGraceDays: number;
  subscription: Subscription;
}

// ---------------------------------------------------------------------------
// runDunningSweep
// ---------------------------------------------------------------------------

/**
 * Executes a periodic dunning sweep across all subscriptions.
 *
 * Sweep Steps:
 * 1. Evaluates PAST_DUE subscriptions whose grace period (gracePeriodEndsAt) has elapsed
 *    and transitions them to UNPAID with trigger "DUNNING_ENGINE:grace_expired".
 * 2. Evaluates UNPAID subscriptions whose unpaid retention period has elapsed
 *    and transitions them to CANCELED with trigger "DUNNING_ENGINE:automatic_termination".
 * 3. Evaluates TRIALING subscriptions whose trialEnd has elapsed
 *    and transitions them to PAST_DUE with trigger "DUNNING_ENGINE:trial_expired".
 */
export async function runDunningSweep(
  prisma: PrismaClient,
  options?: DunningSweepOptions
): Promise<DunningSweepResult> {
  const referenceDate = options?.referenceDate || new Date();
  const batchSize = options?.batchSize || 100;
  const unpaidRetentionDays = options?.unpaidRetentionDays ?? 14;
  const actorUserId = options?.actorUserId || "system:dunning_worker";

  const workspaceFilter: Prisma.SubscriptionWhereInput = {};
  if (options?.workspaceId) {
    workspaceFilter.workspaceId = options.workspaceId;
  } else if (options?.workspaceIds && options.workspaceIds.length > 0) {
    workspaceFilter.workspaceId = { in: options.workspaceIds };
  }

  const result: DunningSweepResult = {
    processedPastDueCount: 0,
    transitionedToUnpaidCount: 0,
    transitionedToCanceledCount: 0,
    transitionedTrialExpiredCount: 0,
    errors: [],
  };

  // 1. Process Expired PAST_DUE Subscriptions (gracePeriodEndsAt <= referenceDate)
  const expiredPastDueSubs = await prisma.subscription.findMany({
    where: {
      ...workspaceFilter,
      status: SubscriptionStatus.PAST_DUE,
      gracePeriodEndsAt: {
        lte: referenceDate,
        not: null,
      },
    },
    take: batchSize,
  });

  result.processedPastDueCount = expiredPastDueSubs.length;

  for (const sub of expiredPastDueSubs) {
    try {
      await prisma.$transaction(async (tx) => {
        await transitionSubscriptionStatus(tx, {
          subscriptionId: sub.id,
          toStatus: SubscriptionStatus.UNPAID,
          triggerSource: "DUNNING_ENGINE:grace_expired",
          actorUserId,
          providerEventTimestamp: referenceDate,
        });
      });
      result.transitionedToUnpaidCount++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({ subscriptionId: sub.id, error: errorMsg });
    }
  }

  // 2. Process Expired UNPAID Subscriptions (updatedAt <= referenceDate - retentionDays)
  const unpaidCutoff = new Date(
    referenceDate.getTime() - unpaidRetentionDays * 24 * 60 * 60 * 1000
  );

  const expiredUnpaidSubs = await prisma.subscription.findMany({
    where: {
      ...workspaceFilter,
      status: SubscriptionStatus.UNPAID,
      updatedAt: {
        lte: unpaidCutoff,
      },
    },
    take: batchSize,
  });

  for (const sub of expiredUnpaidSubs) {
    try {
      await prisma.$transaction(async (tx) => {
        await transitionSubscriptionStatus(tx, {
          subscriptionId: sub.id,
          toStatus: SubscriptionStatus.CANCELED,
          triggerSource: "DUNNING_ENGINE:automatic_termination",
          actorUserId,
          providerEventTimestamp: referenceDate,
        });
      });
      result.transitionedToCanceledCount++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({ subscriptionId: sub.id, error: errorMsg });
    }
  }

  // 3. Process Expired TRIALING Subscriptions (trialEnd <= referenceDate)
  const expiredTrialSubs = await prisma.subscription.findMany({
    where: {
      ...workspaceFilter,
      status: SubscriptionStatus.TRIALING,
      trialEnd: {
        lte: referenceDate,
        not: null,
      },
    },
    take: batchSize,
  });


  for (const sub of expiredTrialSubs) {
    try {
      await prisma.$transaction(async (tx) => {
        await transitionSubscriptionStatus(tx, {
          subscriptionId: sub.id,
          toStatus: SubscriptionStatus.PAST_DUE,
          triggerSource: "DUNNING_ENGINE:trial_expired",
          actorUserId,
          providerEventTimestamp: referenceDate,
        });
      });
      result.transitionedTrialExpiredCount++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({ subscriptionId: sub.id, error: errorMsg });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// processSubscriptionDunningAttempt
// ---------------------------------------------------------------------------

/**
 * Evaluates and processes dunning rules for an individual subscription.
 */
export async function processSubscriptionDunningAttempt(
  prisma: PrismaClient,
  subscriptionId: string,
  options?: DunningAttemptOptions
): Promise<DunningAttemptResult> {
  const referenceDate = options?.referenceDate || new Date();
  const unpaidRetentionDays = options?.unpaidRetentionDays ?? 14;
  const actorUserId = options?.actorUserId || "system:dunning_worker";

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    throw new SubscriptionNotFoundError(subscriptionId);
  }

  // Case 1: Subscription is PAST_DUE
  if (subscription.status === SubscriptionStatus.PAST_DUE) {
    const graceEnds = subscription.gracePeriodEndsAt;

    if (graceEnds && referenceDate.getTime() >= graceEnds.getTime()) {
      // Grace period expired -> transition to UNPAID
      let updatedSub: Subscription = subscription;
      await prisma.$transaction(async (tx) => {
        const res = await transitionSubscriptionStatus(tx, {
          subscriptionId: subscription.id,
          toStatus: SubscriptionStatus.UNPAID,
          triggerSource: "DUNNING_ENGINE:grace_expired",
          actorUserId,
          providerEventTimestamp: referenceDate,
        });
        updatedSub = res.subscription;
      });

      return {
        subscriptionId: subscription.id,
        status: SubscriptionStatus.UNPAID,
        actionTaken: "TRANSITIONED_TO_UNPAID",
        remainingGraceDays: 0,
        subscription: updatedSub,
      };
    }

    // Grace period still active
    const remainingMs = graceEnds ? graceEnds.getTime() - referenceDate.getTime() : 0;
    const remainingGraceDays = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));

    return {
      subscriptionId: subscription.id,
      status: SubscriptionStatus.PAST_DUE,
      actionTaken: "ACTIVE_GRACE_PERIOD",
      remainingGraceDays,
      subscription,
    };
  }

  // Case 2: Subscription is UNPAID
  if (subscription.status === SubscriptionStatus.UNPAID) {
    const unpaidCutoff = new Date(
      referenceDate.getTime() - unpaidRetentionDays * 24 * 60 * 60 * 1000
    );

    if (subscription.updatedAt.getTime() <= unpaidCutoff.getTime()) {
      let updatedSub: Subscription = subscription;
      await prisma.$transaction(async (tx) => {
        const res = await transitionSubscriptionStatus(tx, {
          subscriptionId: subscription.id,
          toStatus: SubscriptionStatus.CANCELED,
          triggerSource: "DUNNING_ENGINE:automatic_termination",
          actorUserId,
          providerEventTimestamp: referenceDate,
        });
        updatedSub = res.subscription;
      });

      return {
        subscriptionId: subscription.id,
        status: SubscriptionStatus.CANCELED,
        actionTaken: "TRANSITIONED_TO_CANCELED",
        remainingGraceDays: 0,
        subscription: updatedSub,
      };
    }

    return {
      subscriptionId: subscription.id,
      status: SubscriptionStatus.UNPAID,
      actionTaken: "UNPAID_PENDING_TERMINATION",
      remainingGraceDays: 0,
      subscription,
    };
  }

  // Case 3: Subscription is TRIALING
  if (subscription.status === SubscriptionStatus.TRIALING) {
    if (subscription.trialEnd && referenceDate.getTime() >= subscription.trialEnd.getTime()) {
      let updatedSub: Subscription = subscription;
      await prisma.$transaction(async (tx) => {
        const res = await transitionSubscriptionStatus(tx, {
          subscriptionId: subscription.id,
          toStatus: SubscriptionStatus.PAST_DUE,
          triggerSource: "DUNNING_ENGINE:trial_expired",
          actorUserId,
          providerEventTimestamp: referenceDate,
        });
        updatedSub = res.subscription;
      });

      return {
        subscriptionId: subscription.id,
        status: SubscriptionStatus.PAST_DUE,
        actionTaken: "TRANSITIONED_TO_PAST_DUE",
        remainingGraceDays: 7,
        subscription: updatedSub,
      };
    }

    return {
      subscriptionId: subscription.id,
      status: SubscriptionStatus.TRIALING,
      actionTaken: "ACTIVE_TRIAL",
      remainingGraceDays: 0,
      subscription,
    };
  }

  // Case 4: Other non-dunning status (ACTIVE, PAUSED, CANCELED, INCOMPLETE)
  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    actionTaken: "NOOP",
    remainingGraceDays: 0,
    subscription,
  };
}
