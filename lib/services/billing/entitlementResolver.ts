/**
 * Phase 1.15.5 — Entitlement Resolver & Quota Guard Enforcement Protocol
 *
 * Implements the exact 3-tier resolution algorithm from the locked §5.2 specification
 * (as corrected during the 1.15.1 audit cycle: UNLIMITED sentinel is checked and returned
 * before any numeric multiplier parsing, at every tier).
 *
 * `resolveEntitlement()` — 3-tier precedence:
 *   Tier 1: WorkspaceEntitlementOverride (expires-aware)
 *   Tier 2: SubscriptionPlanFeature via current non-terminal Subscription
 *   Tier 3: ENTITLEMENT_REGISTRY[featureKey].defaultValue
 *
 * `assertEntitlement()` — §5.3 guard protocol:
 *   - isUnlimited → pass immediately
 *   - BOOLEAN feature → throw PlanFeatureNotEnabledError if false
 *   - NUMERIC_LIMIT feature → compute usage, throw QuotaExceededError if over limit
 */

import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
  ENTITLEMENT_REGISTRY,
  type EntitlementKey,
} from "./entitlementRegistry";
import type { ResolvedEntitlement, EntitlementValue } from "./billing.types";
import {
  InvalidEntitlementMultiplierError,
  PlanFeatureNotEnabledError,
  QuotaExceededError,
} from "./billingErrors";
import { NON_TERMINAL_SUBSCRIPTION_STATUSES } from "./subscriptionStateMachine";
import { computeCurrentUsage } from "./usageComputation";

// ---------------------------------------------------------------------------
// Internal type for the Prisma client union accepted by this module
// ---------------------------------------------------------------------------

type DbClient = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// resolveEntitlement — 3-tier resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the effective entitlement for a workspace feature key using the
 * three-tier precedence hierarchy from §5.2.
 *
 * Tier precedence: WorkspaceEntitlementOverride ≻ SubscriptionPlanFeature ≻ SystemDefault
 *
 * The UNLIMITED sentinel ("UNLIMITED") is always checked first at each tier before
 * any numeric multiplier math, ensuring enterprise unlimited configurations are
 * never misclassified as malformed multipliers.
 *
 * @param prisma  - PrismaClient or Prisma.TransactionClient (so callers can resolve
 *                  within the same transaction as the mutation being guarded).
 * @param workspaceId - Target workspace.
 * @param featureKey  - Registry key to resolve.
 */
export async function resolveEntitlement(
  prisma: DbClient,
  workspaceId: string,
  featureKey: EntitlementKey
): Promise<ResolvedEntitlement> {
  const definition = ENTITLEMENT_REGISTRY[featureKey];
  const now = new Date();

  // -------------------------------------------------------------------------
  // Tier 1: Active Workspace-Level Override
  // Active condition: !expiresAt || expiresAt > now
  // -------------------------------------------------------------------------
  const override = await (prisma as PrismaClient).workspaceEntitlementOverride.findUnique({
    where: {
      workspaceId_featureKey: { workspaceId, featureKey },
    },
    select: {
      overrideValueJson: true,
      expiresAt: true,
    },
  });

  if (override && (!override.expiresAt || override.expiresAt > now)) {
    const rawValue = override.overrideValueJson;

    // UNLIMITED sentinel check at Tier 1 — before any further processing
    if (rawValue === "UNLIMITED") {
      return {
        featureKey,
        value: "UNLIMITED",
        source: "WORKSPACE_OVERRIDE",
        isUnlimited: true,
        expiresAt: override.expiresAt ?? null,
      };
    }

    return {
      featureKey,
      value: rawValue as EntitlementValue,
      source: "WORKSPACE_OVERRIDE",
      isUnlimited: false,
      expiresAt: override.expiresAt ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Tier 2: Active Subscription Plan Feature
  // Subscription must be in a NON_TERMINAL status (imported from subscriptionStateMachine
  // — not redefined locally, so this list can never drift from the state machine).
  // -------------------------------------------------------------------------
  const activeSubscription = await (prisma as PrismaClient).subscription.findFirst({
    where: {
      workspaceId,
      status: { in: Array.from(NON_TERMINAL_SUBSCRIPTION_STATUSES) },
    },
    select: {
      id: true,
      planId: true,
      seatsCount: true,
      currentPeriodEnd: true,
      plan: {
        select: {
          features: {
            where: { featureKey },
            select: {
              valueJson: true,
              scalesWithSeats: true,
            },
          },
        },
      },
    },
  });

  if (activeSubscription?.plan?.features?.length) {
    const planFeature = activeSubscription.plan.features[0];
    const rawValue = planFeature.valueJson;

    // UNLIMITED sentinel check at Tier 2 — MUST come before the scalesWithSeats
    // multiplier block, per the 1.15.1 audit correction. An enterprise unlimited
    // plan feature with scalesWithSeats: true must return UNLIMITED, not throw.
    if (rawValue === "UNLIMITED") {
      return {
        featureKey,
        value: "UNLIMITED",
        source: "SUBSCRIPTION_PLAN",
        isUnlimited: true,
        expiresAt: activeSubscription.currentPeriodEnd,
      };
    }

    // Generic dynamic seat scaling with multiplier assertion (§5.1 point 3)
    if (planFeature.scalesWithSeats) {
      const multiplier = Number(rawValue);

      // Validation: multiplier must be a positive integer in range [1, 100]
      if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > 100) {
        throw new InvalidEntitlementMultiplierError(
          featureKey,
          rawValue,
          activeSubscription.planId
        );
      }

      const resolvedValue = multiplier * activeSubscription.seatsCount;

      return {
        featureKey,
        value: resolvedValue,
        source: "SUBSCRIPTION_PLAN",
        isUnlimited: false,
        expiresAt: activeSubscription.currentPeriodEnd,
      };
    }

    // Fixed plan limit (scalesWithSeats: false)
    return {
      featureKey,
      value: rawValue as EntitlementValue,
      source: "SUBSCRIPTION_PLAN",
      isUnlimited: false,
      expiresAt: activeSubscription.currentPeriodEnd,
    };
  }

  // -------------------------------------------------------------------------
  // Tier 3: System Baseline Default Fallback
  // isUnlimited correctly derived from whether defaultValue === 'UNLIMITED'
  // -------------------------------------------------------------------------
  const defaultValue = definition.defaultValue;

  return {
    featureKey,
    value: defaultValue,
    source: "DEFAULT_FALLBACK",
    isUnlimited: (defaultValue as unknown) === "UNLIMITED",
    expiresAt: null,
  };
}

// ---------------------------------------------------------------------------
// assertEntitlement — §5.3 Quota Guard Enforcement Protocol
// ---------------------------------------------------------------------------

/**
 * Guards a capacity-expanding mutation by asserting the workspace is entitled
 * to proceed, per §5.3.
 *
 * - isUnlimited → passes immediately (both BOOLEAN and NUMERIC checks bypassed).
 * - BOOLEAN feature → throws PlanFeatureNotEnabledError (403) if resolved value is false.
 * - NUMERIC_LIMIT feature → queries current usage, throws QuotaExceededError (402)
 *   if currentUsage + requestedIncrement > resolvedLimit.
 *
 * @param prisma             - PrismaClient or Prisma.TransactionClient (guard must run
 *                             inside the same transaction as the mutation to avoid TOCTOU races).
 * @param workspaceId        - Target workspace.
 * @param featureKey         - The entitlement key to check.
 * @param requestedIncrement - Number of units being added (defaults to 1). Only
 *                             meaningful for NUMERIC_LIMIT features.
 */
export async function assertEntitlement(
  prisma: DbClient,
  workspaceId: string,
  featureKey: EntitlementKey,
  requestedIncrement: number = 1
): Promise<void> {
  const resolved = await resolveEntitlement(prisma, workspaceId, featureKey);

  // Unlimited short-circuits all checks
  if (resolved.isUnlimited) return;

  const definition = ENTITLEMENT_REGISTRY[featureKey];

  if (definition.type === "BOOLEAN") {
    // Boolean feature gate: throw if the feature is not enabled
    if (resolved.value === false) {
      throw new PlanFeatureNotEnabledError(featureKey, workspaceId);
    }
    return;
  }

  if (definition.type === "NUMERIC_LIMIT") {
    // Numeric quota guard: compare current usage + requested increment against limit
    const limit = resolved.value as number;
    const currentUsage = await computeCurrentUsage(prisma, workspaceId, featureKey);

    if (currentUsage + requestedIncrement > limit) {
      throw new QuotaExceededError(featureKey, currentUsage, limit, workspaceId);
    }
  }
}
