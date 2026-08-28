/**
 * Phase 1.15.4 — Subscription Lifecycle Engine & State Machine Transitions Service
 * Implements transactional state transitions, single active subscription invariant enforcement,
 * out-of-order webhook guard, cancellation semantics, and admin override operations.
 */

import { Prisma, Subscription } from "@/generated/prisma/client";
import { SubscriptionStatus } from "@/generated/prisma/enums";
import {
  DuplicateActiveSubscriptionError,
} from "./billingErrors";
import {
  assertValidTransition,
  NON_TERMINAL_SUBSCRIPTION_STATUSES,
} from "./subscriptionStateMachine";

// ============================================================================
// Parameter & Result Interfaces
// ============================================================================

export interface CreateSubscriptionParams {
  workspaceId: string;
  accountId: string;
  planId: string;
  status?: SubscriptionStatus;
  providerSubscriptionId?: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  seatsCount?: number;
  triggerSource?: string;
  actorUserId?: string | null;
  metadataJson?: Prisma.InputJsonValue;
}

export interface TransitionSubscriptionStatusParams {
  subscriptionId: string;
  toStatus: SubscriptionStatus;
  triggerSource: string;
  actorUserId?: string | null;
  providerEventTimestamp?: Date | null;
  metadataJson?: Prisma.InputJsonValue;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  seatsCount?: number;
}

export type TransitionResult =
  | { outcome: "APPLIED"; subscription: Subscription }
  | { outcome: "IGNORED_OUT_OF_ORDER"; subscription: Subscription; reason: string }
  | { outcome: "NOOP_SAME_STATE"; subscription: Subscription };

export interface CancelSubscriptionParams {
  subscriptionId: string;
  immediately: boolean;
  actorUserId: string;
  reason?: string;
}

export interface ApplyAdminOverrideParams {
  subscriptionId: string;
  toStatus: SubscriptionStatus;
  actorUserId: string;
  reason: string;
  metadataJson?: Record<string, unknown>;
}

// ============================================================================
// Subscription Lifecycle Functions
// ============================================================================

/**
 * Creates a new subscription while strictly enforcing the Single Active Subscription Invariant (§3.2).
 * Dual-enforced via pre-check query and database constraint translation.
 */
export async function createSubscription(
  tx: Prisma.TransactionClient,
  params: CreateSubscriptionParams
): Promise<Subscription> {
  const initialStatus = params.status || SubscriptionStatus.TRIALING;

  // Pre-check for existing non-terminal subscription on this account
  if ((NON_TERMINAL_SUBSCRIPTION_STATUSES as readonly SubscriptionStatus[]).includes(initialStatus)) {
    const existing = await tx.subscription.findFirst({
      where: {
        accountId: params.accountId,
        status: { in: NON_TERMINAL_SUBSCRIPTION_STATUSES as any },
      },
    });

    if (existing) {
      throw new DuplicateActiveSubscriptionError(params.accountId, existing.id);
    }
  }

  let created: Subscription;

  try {
    created = await tx.subscription.create({
      data: {
        workspaceId: params.workspaceId,
        accountId: params.accountId,
        planId: params.planId,
        status: initialStatus,
        providerSubscriptionId: params.providerSubscriptionId || null,
        currentPeriodStart: params.currentPeriodStart,
        currentPeriodEnd: params.currentPeriodEnd,
        trialStart: params.trialStart || null,
        trialEnd: params.trialEnd || null,
        cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
        seatsCount: params.seatsCount ?? 1,
      },
    });
  } catch (err: any) {
    // Catch database partial unique index violation (race condition defense)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const conflicting = await tx.subscription.findFirst({
        where: {
          accountId: params.accountId,
          status: { in: NON_TERMINAL_SUBSCRIPTION_STATUSES as any },
        },
        select: { id: true },
      });
      throw new DuplicateActiveSubscriptionError(params.accountId, conflicting?.id);
    }
    throw err;
  }

  // Record initial creation history
  await tx.subscriptionHistory.create({
    data: {
      subscriptionId: created.id,
      fromStatus: null,
      toStatus: created.status,
      triggerSource: params.triggerSource || "SYSTEM:create",
      actorUserId: params.actorUserId || null,
      metadataJson: params.metadataJson as any,
    },
  });

  return created;
}

/**
 * Transitions a subscription to a new state strictly verified against the state machine guard table (§4.2).
 * Applies side-effects (grace periods, dunning counters, cancellation dates) and writes audit history.
 */
export async function transitionSubscriptionStatus(
  tx: Prisma.TransactionClient,
  params: TransitionSubscriptionStatusParams
): Promise<TransitionResult> {
  const subscription = await tx.subscription.findUnique({
    where: { id: params.subscriptionId },
  });

  if (!subscription) {
    throw new Error(`Subscription '${params.subscriptionId}' not found`);
  }

  // Out-of-Order Webhook Guard (§6.1)
  if (
    params.providerEventTimestamp &&
    subscription.lastSyncedProviderEventAt &&
    params.providerEventTimestamp.getTime() < subscription.lastSyncedProviderEventAt.getTime()
  ) {
    return {
      outcome: "IGNORED_OUT_OF_ORDER",
      subscription,
      reason: `Provider event timestamp (${params.providerEventTimestamp.toISOString()}) is older than last synced timestamp (${subscription.lastSyncedProviderEventAt.toISOString()})`,
    };
  }

  // Same-State Idempotency Check
  if (subscription.status === params.toStatus) {
    if (
      params.triggerSource.startsWith("WEBHOOK") ||
      params.triggerSource === "SYNC_RECONCILIATION"
    ) {
      const sameStateData: Prisma.SubscriptionUpdateInput = {};
      if (
        params.providerEventTimestamp &&
        (!subscription.lastSyncedProviderEventAt ||
          params.providerEventTimestamp.getTime() > subscription.lastSyncedProviderEventAt.getTime())
      ) {
        sameStateData.lastSyncedProviderEventAt = params.providerEventTimestamp;
      }
      if (params.currentPeriodStart) {
        sameStateData.currentPeriodStart = params.currentPeriodStart;
      }
      if (params.currentPeriodEnd) {
        sameStateData.currentPeriodEnd = params.currentPeriodEnd;
      }
      if (params.seatsCount !== undefined) {
        sameStateData.seatsCount = params.seatsCount;
      }
      if (params.cancelAtPeriodEnd !== undefined) {
        sameStateData.cancelAtPeriodEnd = params.cancelAtPeriodEnd;
      }

      let currentSub = subscription;
      if (Object.keys(sameStateData).length > 0) {
        currentSub = await tx.subscription.update({
          where: { id: subscription.id },
          data: sameStateData,
        });
      }
      return {
        outcome: "NOOP_SAME_STATE",
        subscription: currentSub,
      };
    }

    // If not an idempotent webhook/sync, let assertion check and reject same-state attempt
    assertValidTransition(subscription.status, params.toStatus, params.triggerSource);
  }

  // Assert transition validity against immutable state table
  assertValidTransition(subscription.status, params.toStatus, params.triggerSource);

  // Compute status-specific side effects per §4.2
  const updateData: Prisma.SubscriptionUpdateInput = {
    status: params.toStatus,
  };

  if (params.toStatus === SubscriptionStatus.PAST_DUE) {
    updateData.gracePeriodEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    updateData.dunningAttemptsCount = { increment: 1 };
  }

  if (
    subscription.status === SubscriptionStatus.PAST_DUE &&
    params.toStatus === SubscriptionStatus.ACTIVE
  ) {
    updateData.gracePeriodEndsAt = null;
    updateData.dunningAttemptsCount = 0;
  }

  if (params.toStatus === SubscriptionStatus.CANCELED) {
    const now = new Date();
    updateData.canceledAt = subscription.canceledAt || now;
    updateData.endedAt = subscription.endedAt || now;
  }

  if (
    subscription.status === SubscriptionStatus.TRIALING &&
    params.toStatus === SubscriptionStatus.ACTIVE
  ) {
    updateData.trialEnd = subscription.trialEnd || new Date();
  }

  if (params.providerEventTimestamp) {
    updateData.lastSyncedProviderEventAt = params.providerEventTimestamp;
  }

  if (params.currentPeriodStart) {
    updateData.currentPeriodStart = params.currentPeriodStart;
  }

  if (params.currentPeriodEnd) {
    updateData.currentPeriodEnd = params.currentPeriodEnd;
  }

  if (params.cancelAtPeriodEnd !== undefined) {
    updateData.cancelAtPeriodEnd = params.cancelAtPeriodEnd;
  }

  if (params.seatsCount !== undefined) {
    updateData.seatsCount = params.seatsCount;
  }

  const updatedSubscription = await tx.subscription.update({
    where: { id: subscription.id },
    data: updateData,
  });

  // Record audit history
  await tx.subscriptionHistory.create({
    data: {
      subscriptionId: updatedSubscription.id,
      fromStatus: subscription.status,
      toStatus: updatedSubscription.status,
      triggerSource: params.triggerSource,
      actorUserId: params.actorUserId || null,
      metadataJson: params.metadataJson as any,
    },
  });

  return {
    outcome: "APPLIED",
    subscription: updatedSubscription,
  };
}

/**
 * Handles user subscription cancellation per §7.2.
 * If immediately=true, transitions status directly to CANCELED.
 * If immediately=false, sets cancelAtPeriodEnd=true while keeping status unchanged until current period end.
 */
export async function cancelSubscription(
  tx: Prisma.TransactionClient,
  params: CancelSubscriptionParams
): Promise<TransitionResult> {
  if (!params.actorUserId || params.actorUserId.trim().length === 0) {
    throw new Error("Subscription cancellation requires a valid actorUserId");
  }

  if (params.immediately) {
    return transitionSubscriptionStatus(tx, {
      subscriptionId: params.subscriptionId,
      toStatus: SubscriptionStatus.CANCELED,
      triggerSource: "USER_ACTION:cancel",
      actorUserId: params.actorUserId,
      metadataJson: {
        reason: params.reason || "Immediate user cancellation",
        immediately: true,
      },
    });
  }

  const subscription = await tx.subscription.findUnique({
    where: { id: params.subscriptionId },
  });

  if (!subscription) {
    throw new Error(`Subscription '${params.subscriptionId}' not found`);
  }

  const updatedSubscription = await tx.subscription.update({
    where: { id: subscription.id },
    data: {
      cancelAtPeriodEnd: true,
    },
  });

  await tx.subscriptionHistory.create({
    data: {
      subscriptionId: updatedSubscription.id,
      fromStatus: subscription.status,
      toStatus: subscription.status,
      triggerSource: "USER_ACTION:cancel_at_period_end",
      actorUserId: params.actorUserId,
      metadataJson: {
        cancelAtPeriodEnd: true,
        scheduledCancellationAt: subscription.currentPeriodEnd,
        reason: params.reason || "Scheduled cancellation at period end",
      },
    },
  });

  return {
    outcome: "APPLIED",
    subscription: updatedSubscription,
  };
}

/**
 * Internal-only function for platform administrative overrides (§4.2).
 * Requires a valid actorUserId and a non-empty explanation reason.
 */
export async function applyAdminOverride(
  tx: Prisma.TransactionClient,
  params: ApplyAdminOverrideParams
): Promise<TransitionResult> {
  if (!params.reason || params.reason.trim().length === 0) {
    throw new Error("Admin override requires a non-empty explanation reason");
  }

  if (!params.actorUserId || params.actorUserId.trim().length === 0) {
    throw new Error("Admin override requires a valid actorUserId");
  }

  return transitionSubscriptionStatus(tx, {
    subscriptionId: params.subscriptionId,
    toStatus: params.toStatus,
    triggerSource: "ADMIN_OVERRIDE",
    actorUserId: params.actorUserId,
    metadataJson: {
      reason: params.reason.trim(),
      ...params.metadataJson,
    },
  });
}
