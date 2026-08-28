/**
 * Phase 1.15.10 — SaaS Billing Reconciliation Service & Worker
 *
 * Implements:
 * 1. Single-subscription reconciliation against billing provider adapter (`reconcileSubscription`).
 * 2. Multi-tenant background reconciliation sweep (`runReconciliationSweep`).
 * 3. Drift detection (status, period dates, seats count, cancel-at-period-end).
 * 4. Idempotent state correction strictly through `transitionSubscriptionStatus`.
 * 5. Structured reconciliation result logging.
 */

import { PrismaClient, Prisma, Subscription } from "@/generated/prisma/client";
import { SubscriptionStatus } from "@/generated/prisma/enums";
import { SubscriptionNotFoundError } from "./billingErrors";
import { getBillingAdapter } from "./providers/getBillingAdapter";
import {
  transitionSubscriptionStatus,
} from "./subscriptionService";
import { NON_TERMINAL_SUBSCRIPTION_STATUSES } from "./subscriptionStateMachine";

// ---------------------------------------------------------------------------
// Interfaces & Types
// ---------------------------------------------------------------------------

export type DriftType =
  | "STATUS_MISMATCH"
  | "PERIOD_MISMATCH"
  | "SEATS_MISMATCH"
  | "CANCEL_AT_PERIOD_END_MISMATCH";

export type ReconciliationAction =
  | "STATUS_TRANSITIONED"
  | "ATTRIBUTES_SYNCED"
  | "IN_SYNC"
  | "SKIPPED_UNLINKED";

export interface SubscriptionSnapshot {
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  seatsCount: number;
  cancelAtPeriodEnd: boolean;
}

export interface ReconcileSubscriptionOptions {
  actorUserId?: string | null;
  referenceDate?: Date;
}

export interface ReconciliationResult {
  subscriptionId: string;
  workspaceId: string;
  providerSubscriptionId: string | null;
  driftDetected: boolean;
  driftTypes: DriftType[];
  previousState: SubscriptionSnapshot;
  correctedState: SubscriptionSnapshot;
  actionTaken: ReconciliationAction;
  subscription: Subscription;
}

export interface ReconciliationSweepOptions {
  workspaceId?: string;
  workspaceIds?: string[];
  unsyncedHours?: number;
  onlyNonTerminal?: boolean;
  batchSize?: number;
  actorUserId?: string | null;
  referenceDate?: Date;
}

export interface ReconciliationSweepResult {
  totalScanned: number;
  driftCount: number;
  correctedCount: number;
  inSyncCount: number;
  skippedCount: number;
  results: ReconciliationResult[];
  errors: Array<{ subscriptionId: string; error: string }>;
}

function createSnapshot(sub: {
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  seatsCount: number;
  cancelAtPeriodEnd: boolean;
}): SubscriptionSnapshot {
  return {
    status: sub.status,
    currentPeriodStart: new Date(sub.currentPeriodStart),
    currentPeriodEnd: new Date(sub.currentPeriodEnd),
    seatsCount: sub.seatsCount,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };
}

/**
 * Determines the valid trigger source per subscriptionStateMachine for a target status.
 */
function resolveReconciliationTrigger(
  fromStatus: SubscriptionStatus,
  toStatus: SubscriptionStatus
): string {
  if (toStatus === SubscriptionStatus.ACTIVE) {
    return "SYNC_RECONCILIATION";
  }
  if (toStatus === SubscriptionStatus.CANCELED) {
    if (fromStatus === SubscriptionStatus.ACTIVE) {
      return "WEBHOOK";
    }
    if (fromStatus === SubscriptionStatus.TRIALING) {
      return "USER_ACTION:cancel";
    }
    return "WEBHOOK:customer.subscription.deleted";
  }
  if (toStatus === SubscriptionStatus.INCOMPLETE_EXPIRED) {
    return "RECONCILIATION_WORKER";
  }
  return "SYNC_RECONCILIATION";
}

// ---------------------------------------------------------------------------
// reconcileSubscription
// ---------------------------------------------------------------------------

/**
 * Reconciles a single subscription with its external provider state.
 */
export async function reconcileSubscription(
  prisma: PrismaClient,
  subscriptionId: string,
  options?: ReconcileSubscriptionOptions
): Promise<ReconciliationResult> {
  const referenceDate = options?.referenceDate || new Date();
  const actorUserId = options?.actorUserId || "system:reconciliation_worker";

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { account: true },
  });

  if (!subscription) {
    throw new SubscriptionNotFoundError(subscriptionId);
  }

  const previousSnapshot = createSnapshot(subscription);

  // 1. Unlinked Local Subscriptions (e.g. without external provider ID)
  if (!subscription.providerSubscriptionId) {
    return {
      subscriptionId: subscription.id,
      workspaceId: subscription.workspaceId,
      providerSubscriptionId: null,
      driftDetected: false,
      driftTypes: [],
      previousState: previousSnapshot,
      correctedState: previousSnapshot,
      actionTaken: "SKIPPED_UNLINKED",
      subscription,
    };
  }

  // 2. Fetch Provider Subscription State
  const adapter = getBillingAdapter(subscription.account.provider);
  const providerState = await adapter.fetchSubscription(subscription.providerSubscriptionId);

  // 3. Detect Drift
  const driftTypes: DriftType[] = [];

  const statusMismatch = subscription.status !== providerState.status;
  if (statusMismatch) {
    driftTypes.push("STATUS_MISMATCH");
  }

  const periodMismatch =
    subscription.currentPeriodStart.getTime() !== providerState.currentPeriodStart.getTime() ||
    subscription.currentPeriodEnd.getTime() !== providerState.currentPeriodEnd.getTime();
  if (periodMismatch) {
    driftTypes.push("PERIOD_MISMATCH");
  }

  const seatsMismatch = subscription.seatsCount !== providerState.seatsCount;
  if (seatsMismatch) {
    driftTypes.push("SEATS_MISMATCH");
  }

  const cancelAtPeriodEndMismatch =
    subscription.cancelAtPeriodEnd !== providerState.cancelAtPeriodEnd;
  if (cancelAtPeriodEndMismatch) {
    driftTypes.push("CANCEL_AT_PERIOD_END_MISMATCH");
  }

  // 4. Case A: In-Sync (No Drift)
  if (driftTypes.length === 0) {
    // Update lastSyncedProviderEventAt if needed
    const syncedSub = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { lastSyncedProviderEventAt: referenceDate },
    });

    return {
      subscriptionId: subscription.id,
      workspaceId: subscription.workspaceId,
      providerSubscriptionId: subscription.providerSubscriptionId,
      driftDetected: false,
      driftTypes: [],
      previousState: previousSnapshot,
      correctedState: previousSnapshot,
      actionTaken: "IN_SYNC",
      subscription: syncedSub,
    };
  }

  // 5. Case B: Status Drift Detected -> Transition via State Machine
  if (statusMismatch) {
    const triggerSource = resolveReconciliationTrigger(subscription.status, providerState.status);

    let updatedSub: Subscription = subscription;
    await prisma.$transaction(async (tx) => {
      const res = await transitionSubscriptionStatus(tx, {
        subscriptionId: subscription.id,
        toStatus: providerState.status,
        triggerSource,
        actorUserId,
        providerEventTimestamp: referenceDate,
        currentPeriodStart: providerState.currentPeriodStart,
        currentPeriodEnd: providerState.currentPeriodEnd,
        seatsCount: providerState.seatsCount,
        cancelAtPeriodEnd: providerState.cancelAtPeriodEnd,
      });
      updatedSub = res.subscription;
    });

    return {
      subscriptionId: subscription.id,
      workspaceId: subscription.workspaceId,
      providerSubscriptionId: subscription.providerSubscriptionId,
      driftDetected: true,
      driftTypes,
      previousState: previousSnapshot,
      correctedState: createSnapshot(updatedSub),
      actionTaken: "STATUS_TRANSITIONED",
      subscription: updatedSub,
    };
  }

  // 6. Case C: Same-Status Attribute Drift (Period Dates / Seats / CancelAtPeriodEnd)
  let updatedSub: Subscription = subscription;
  await prisma.$transaction(async (tx) => {
    const res = await transitionSubscriptionStatus(tx, {
      subscriptionId: subscription.id,
      toStatus: subscription.status,
      triggerSource: "SYNC_RECONCILIATION",
      actorUserId,
      providerEventTimestamp: referenceDate,
      currentPeriodStart: providerState.currentPeriodStart,
      currentPeriodEnd: providerState.currentPeriodEnd,
      seatsCount: providerState.seatsCount,
      cancelAtPeriodEnd: providerState.cancelAtPeriodEnd,
    });
    updatedSub = res.subscription;
  });

  return {
    subscriptionId: subscription.id,
    workspaceId: subscription.workspaceId,
    providerSubscriptionId: subscription.providerSubscriptionId,
    driftDetected: true,
    driftTypes,
    previousState: previousSnapshot,
    correctedState: createSnapshot(updatedSub),
    actionTaken: "ATTRIBUTES_SYNCED",
    subscription: updatedSub,
  };
}

// ---------------------------------------------------------------------------
// runReconciliationSweep
// ---------------------------------------------------------------------------

/**
 * Periodically scans subscriptions and reconciles them against external billing providers.
 */
export async function runReconciliationSweep(
  prisma: PrismaClient,
  options?: ReconciliationSweepOptions
): Promise<ReconciliationSweepResult> {
  const referenceDate = options?.referenceDate || new Date();
  const batchSize = options?.batchSize || 100;
  const onlyNonTerminal = options?.onlyNonTerminal ?? true;
  const actorUserId = options?.actorUserId || "system:reconciliation_worker";

  const whereClause: Prisma.SubscriptionWhereInput = {
    providerSubscriptionId: { not: null },
  };

  if (options?.workspaceId) {
    whereClause.workspaceId = options.workspaceId;
  } else if (options?.workspaceIds && options.workspaceIds.length > 0) {
    whereClause.workspaceId = { in: options.workspaceIds };
  }

  if (onlyNonTerminal) {
    whereClause.status = { in: Array.from(NON_TERMINAL_SUBSCRIPTION_STATUSES) };
  }

  if (options?.unsyncedHours && options.unsyncedHours > 0) {
    const cutoff = new Date(referenceDate.getTime() - options.unsyncedHours * 60 * 60 * 1000);
    whereClause.OR = [
      { lastSyncedProviderEventAt: null },
      { lastSyncedProviderEventAt: { lte: cutoff } },
    ];
  }

  const subscriptions = await prisma.subscription.findMany({
    where: whereClause,
    take: batchSize,
    orderBy: { updatedAt: "asc" },
  });

  const sweepResult: ReconciliationSweepResult = {
    totalScanned: subscriptions.length,
    driftCount: 0,
    correctedCount: 0,
    inSyncCount: 0,
    skippedCount: 0,
    results: [],
    errors: [],
  };

  for (const sub of subscriptions) {
    try {
      const res = await reconcileSubscription(prisma, sub.id, {
        actorUserId,
        referenceDate,
      });

      sweepResult.results.push(res);

      if (res.driftDetected) {
        sweepResult.driftCount++;
        sweepResult.correctedCount++;
      } else if (res.actionTaken === "IN_SYNC") {
        sweepResult.inSyncCount++;
      } else if (res.actionTaken === "SKIPPED_UNLINKED") {
        sweepResult.skippedCount++;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sweepResult.errors.push({ subscriptionId: sub.id, error: errorMsg });
    }
  }

  return sweepResult;
}
