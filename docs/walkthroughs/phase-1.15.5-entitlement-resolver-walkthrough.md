# Phase 1.15.5 — Entitlement Resolver, Quota Guards & Feature Gate Enforcement Middleware Walkthrough

> **Phase**: 1.15.5 (SaaS Billing & Subscriptions)  
> **Status**: COMPLETE & VERIFIED  
> **Documentation Target**: `docs/walkthroughs/phase-1.15.5-entitlement-resolver-walkthrough.md`

---

## Executive Summary

Phase 1.15.5 delivers the runtime enforcement layer of SaaS billing for the Aforden platform:
1. **Three-Tier Entitlement Resolution Engine** (`resolveEntitlement`)
2. **Quota Guard Protocol** (`assertEntitlement`)
3. **Usage Computation Dispatch Table** (`computeCurrentUsage`)
4. **Transactional Service Integrations** across 5 operational domains (`createInvitation`, `createTechnicianProfile`, `createWorkOrder`, `createServiceLocation`, `GET /api/reports/[...reportSlug]`)
5. **Unified Reporting API Error Mapping** (`handleReportingApiError`)

All deliverables strictly follow the locked [`phase-1.15.1-saas-billing-subscriptions-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.15.1-saas-billing-subscriptions-domain-architecture.md) specification (§5.1, §5.2, §5.3), honoring the 1.15.1 audit corrections (UNLIMITED sentinel checked and returned before numeric multiplier math at every resolution tier).

---

## 1. Verbatim: `lib/services/billing/entitlementResolver.ts`

```typescript
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
```

---

## 2. Verbatim: `lib/services/billing/usageComputation.ts`

```typescript
/**
 * Phase 1.15.5 — Current Usage Computation Dispatch Table
 *
 * `computeCurrentUsage()` maps each NUMERIC_LIMIT EntitlementKey to the real
 * database query that counts the workspace's current resource consumption.
 *
 * Design decisions:
 *   - Closed dispatch table (exhaustive switch/if) — adding a new NUMERIC_LIMIT key to the
 *     registry without updating this file will produce a compile-time error (never branch).
 *   - WorkspaceMember.status ACTIVE-only: only active members consume the quota.
 *   - MAX_WORK_ORDERS_PER_MONTH: counts work orders created in the CURRENT CALENDAR MONTH
 *     in the workspace's local timezone, derived via `zonedWallClockToUtc` from Phase 1.14.
 *     The workspace timezone is looked up live — it is not cached.
 *   - MAX_TECHNICIANS: TechnicianProfile has no direct workspaceId; scoped via
 *     Employee.workspaceId (the join path: TechnicianProfile.employee.workspaceId).
 *   - MAX_SERVICE_LOCATIONS: ServiceLocation has no direct workspaceId; scoped via
 *     customer.workspaceId (the join path: ServiceLocation.customer.workspaceId).
 *   - MAX_ATTACHMENT_STORAGE_MB: No Attachment model exists in schema.prisma as of Phase
 *     1.15. Returns 0. The assertEntitlement guard remains functional — the workspace
 *     cannot exceed quota because usage is perpetually 0 — but it does not actually
 *     constrain attachment creation yet. TODO: implement once Attachment model is added.
 *   - Boolean keys (FEATURE_*): calling this function for a BOOLEAN key is a programming
 *     error. It will throw synchronously so the mistake surfaces immediately.
 */

import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import type { EntitlementKey } from "./entitlementRegistry";
import { zonedWallClockToUtc } from "@/lib/services/reporting/dateRange";

// ---------------------------------------------------------------------------
// Internal type alias
// ---------------------------------------------------------------------------

type DbClient = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// computeCurrentUsage
// ---------------------------------------------------------------------------

/**
 * Returns the current integer count of a NUMERIC_LIMIT resource for the workspace.
 *
 * Called exclusively from `assertEntitlement()` for NUMERIC_LIMIT features.
 * Must not be called for BOOLEAN features (will throw immediately).
 */
export async function computeCurrentUsage(
  prisma: DbClient,
  workspaceId: string,
  featureKey: EntitlementKey
): Promise<number> {
  const db = prisma as PrismaClient;

  switch (featureKey) {
    // -----------------------------------------------------------------------
    // MAX_MEMBERS — Active workspace members
    // Counts WorkspaceMember rows where status = ACTIVE (not INVITED, SUSPENDED, REMOVED).
    // -----------------------------------------------------------------------
    case "MAX_MEMBERS": {
      return db.workspaceMember.count({
        where: {
          workspaceId,
          status: "ACTIVE",
        },
      });
    }

    // -----------------------------------------------------------------------
    // MAX_TECHNICIANS — Active technician profiles in the workspace
    // TechnicianProfile.employee.workspaceId scopes to the correct workspace.
    // -----------------------------------------------------------------------
    case "MAX_TECHNICIANS": {
      return db.technicianProfile.count({
        where: {
          employee: {
            workspaceId,
            status: "ACTIVE",
          },
        },
      });
    }

    // -----------------------------------------------------------------------
    // MAX_WORK_ORDERS_PER_MONTH — Work orders created in the CURRENT calendar month
    // Uses the workspace's local timezone so the "month boundary" is culturally correct
    // for the field service business (a WO created at 11:55pm local time on Jan 31
    // counts against January, not February).
    // -----------------------------------------------------------------------
    case "MAX_WORK_ORDERS_PER_MONTH": {
      // Look up workspace timezone
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { timezone: true },
      });

      const tz = workspace?.timezone ?? "UTC";
      const now = new Date();

      // Determine local calendar month boundaries
      const localNow = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);

      const getPart = (type: string) =>
        Number(localNow.find((p) => p.type === type)!.value);

      const localYear = getPart("year");
      const localMonth = getPart("month");

      // First instant of current local month in UTC
      const monthStartUtc = zonedWallClockToUtc(
        localYear,
        localMonth,
        1,
        0,
        0,
        0,
        tz
      );

      // First instant of NEXT local month in UTC (exclusive upper bound)
      const nextMonth = localMonth === 12 ? 1 : localMonth + 1;
      const nextMonthYear = localMonth === 12 ? localYear + 1 : localYear;
      const monthEndUtc = zonedWallClockToUtc(nextMonthYear, nextMonth, 1, 0, 0, 0, tz);

      return db.workOrder.count({
        where: {
          workspaceId,
          createdAt: {
            gte: monthStartUtc,
            lt: monthEndUtc,
          },
        },
      });
    }

    // -----------------------------------------------------------------------
    // MAX_SERVICE_LOCATIONS — Active service location records in the workspace
    // ServiceLocation has no direct workspaceId; scoped through Customer.workspaceId.
    // -----------------------------------------------------------------------
    case "MAX_SERVICE_LOCATIONS": {
      return db.serviceLocation.count({
        where: {
          customer: {
            workspaceId,
          },
        },
      });
    }

    // -----------------------------------------------------------------------
    // MAX_ATTACHMENT_STORAGE_MB — Total attachment storage in MB
    // TODO: No Attachment model exists in schema.prisma as of Phase 1.15.
    // Returns 0 so that assertEntitlement() remains functionally enabled
    // (it resolves the limit correctly from the plan/override/fallback) but
    // does not block attachment creation until the model is built.
    // -----------------------------------------------------------------------
    case "MAX_ATTACHMENT_STORAGE_MB": {
      // TODO(Phase 1.16+): implement once Attachment model with fileSizeBytes field exists.
      return 0;
    }

    // -----------------------------------------------------------------------
    // Boolean feature keys — programming error guard
    // computeCurrentUsage() must never be called for BOOLEAN keys; assertEntitlement()
    // handles BOOLEAN features separately (no usage count needed).
    // -----------------------------------------------------------------------
    case "FEATURE_ADVANCED_REPORTING":
    case "FEATURE_CUSTOM_BRANDING":
    case "FEATURE_SMS_NOTIFICATIONS":
    case "FEATURE_INVENTORY_MULTI_WAREHOUSE":
    case "FEATURE_API_ACCESS": {
      throw new Error(
        `[computeCurrentUsage] Programming error: '${featureKey}' is a BOOLEAN entitlement key. ` +
          `computeCurrentUsage() must only be called for NUMERIC_LIMIT keys. ` +
          `assertEntitlement() handles BOOLEAN keys via PlanFeatureNotEnabledError directly.`
      );
    }

    // -----------------------------------------------------------------------
    // Exhaustiveness guard — TypeScript will error here if a new registry key
    // is added without a corresponding case above.
    // -----------------------------------------------------------------------
    default: {
      const exhaustiveCheck: never = featureKey;
      throw new Error(
        `[computeCurrentUsage] Unhandled EntitlementKey: '${exhaustiveCheck}'. ` +
          `Add a case for this key in usageComputation.ts.`
      );
    }
  }
}
```

---

## 3. Verbatim: `lib/utils/reportingApiError.ts`

```typescript
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization/authorizationResponse";
import {
  ReportNotFoundError,
  UnknownMetricError,
  UnknownDimensionError,
  UnknownFilterError,
  UnsupportedMetricDimensionCombinationError,
  InvalidReportDateRangeError,
  ReportDateRangeTooLargeError,
  ReportCardinalityExceededError,
  ReportExportTooLargeError,
  ReportScopeViolationError,
  ReportingIdentifierViolationError,
  ReportMetricUnavailableError,
} from "@/lib/services/reporting/reportingErrors";
import {
  PlanFeatureNotEnabledError,
  QuotaExceededError,
} from "@/lib/services/billing/billingErrors";

/**
 * Extracts the tenant workspace ID from route context params, standard headers, or query parameters.
 * Precedence:
 * 1. Path param (from context.params.workspaceId)
 * 2. x-workspace-id header
 * 3. workspace-id header
 * 4. ?workspaceId= query parameter
 */
export function extractWorkspaceId(
  request: Request,
  pathWorkspaceId?: string,
): string | null {
  if (pathWorkspaceId && pathWorkspaceId.trim().length > 0) {
    return pathWorkspaceId.trim();
  }

  const headerX = request.headers.get("x-workspace-id")?.trim();
  if (headerX) return headerX;

  const header = request.headers.get("workspace-id")?.trim();
  if (header) return header;

  try {
    const queryParam = new URL(request.url).searchParams
      .get("workspaceId")
      ?.trim();
    if (queryParam) return queryParam;
  } catch {
    // Fallback for relative or malformed URLs
  }

  return null;
}

/**
 * Resolves the tenant workspace ID or returns a standardized 400 MISSING_WORKSPACE response.
 */
export function resolveWorkspaceId(
  request: Request,
  pathWorkspaceId?: string,
):
  | { workspaceId: string; errorResponse?: never }
  | { workspaceId?: never; errorResponse: NextResponse } {
  const workspaceId = extractWorkspaceId(request, pathWorkspaceId);
  if (!workspaceId) {
    return {
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_WORKSPACE",
            message: "Workspace ID is required.",
          },
        },
        { status: 400 },
      ),
    };
  }
  return { workspaceId };
}

/**
 * Extracts URL search parameters as a plain Record<string, any> object for service-layer Zod parsing.
 */
export function extractQueryParams(request: Request): Record<string, any> {
  try {
    const { searchParams } = new URL(request.url);
    const query: Record<string, any> = {};
    searchParams.forEach((value, key) => {
      // Handle repeated keys or comma-separated lists if needed
      if (query[key] !== undefined) {
        if (Array.isArray(query[key])) {
          query[key].push(value);
        } else {
          query[key] = [query[key], value];
        }
      } else {
        query[key] = value;
      }
    });
    return query;
  } catch {
    return {};
  }
}

/**
 * Unified error mapper for the Reporting & Analytics API route layer.
 * Maps domain errors, authorization failures, validation errors, and runtime exceptions
 * to standardized HTTP JSON error responses.
 */
export function handleReportingApiError(
  error: unknown,
  context?: string,
): NextResponse {
  // 1. Authorization & Workspace Access Errors (401 / 403 / 404 for WorkspaceNotFound)
  const authResponse = authorizationErrorResponse(error);
  if (authResponse) {
    return authResponse;
  }

  // 2. Schema / Validation Errors (422 Unprocessable Entity)
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request parameters.",
          fields: error.flatten().fieldErrors,
        },
      },
      { status: 422 },
    );
  }

  // 3. Malformed JSON Body (400 Bad Request)
  if (
    error instanceof SyntaxError &&
    (error.message.includes("JSON") || error.name === "SyntaxError")
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MALFORMED_JSON",
          message: "Malformed JSON in request body.",
        },
      },
      { status: 400 },
    );
  }

  // 4. Billing Entitlement Errors (Phase 1.15.5)
  // PlanFeatureNotEnabledError — feature gated (403 Forbidden)
  // QuotaExceededError — resource quota reached (402 Payment Required)
  if (error instanceof PlanFeatureNotEnabledError || error instanceof QuotaExceededError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.statusCode },
    );
  }

  // 5. Reporting Pure Domain Error Classes (Convention B: statusCode / code metadata)
  if (
    error instanceof ReportNotFoundError ||
    error instanceof UnknownMetricError ||
    error instanceof UnknownDimensionError ||
    error instanceof UnknownFilterError ||
    error instanceof UnsupportedMetricDimensionCombinationError ||
    error instanceof InvalidReportDateRangeError ||
    error instanceof ReportDateRangeTooLargeError ||
    error instanceof ReportCardinalityExceededError ||
    error instanceof ReportExportTooLargeError ||
    error instanceof ReportScopeViolationError ||
    error instanceof ReportingIdentifierViolationError ||
    error instanceof ReportMetricUnavailableError
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.statusCode },
    );
  }

  // 6. Generic duck-typing for custom domain errors
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "statusCode" in error &&
    "message" in error &&
    typeof (error as any).statusCode === "number"
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: String((error as any).code),
          message: String((error as any).message),
        },
      },
      { status: (error as any).statusCode },
    );
  }

  // 7. Unhandled / Unexpected Errors (500 Internal Server Error — sanitizing internals)
  console.error(
    `[Reporting API Error] ${context ? `[${context}] ` : ""}`,
    error,
  );

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred. Please try again later.",
      },
    },
    { status: 500 },
  );
}

## 4. Exact Git Diffs: 5 Service Call-Site Integrations

### Call-Site 1: `lib/services/invitation/createInvitation.ts` (`MAX_MEMBERS`)

```diff
diff --git a/lib/services/invitation/createInvitation.ts b/lib/services/invitation/createInvitation.ts
index 1e392cc..37ef887 100644
--- a/lib/services/invitation/createInvitation.ts
+++ b/lib/services/invitation/createInvitation.ts
@@ -31,6 +31,8 @@ import {
     InvitationRateLimitError,
 } from "./invitationErrors";
 
+import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";
+
 import {
     checkInvitationCreateRateLimit,
 } from "./invitationRateLimit";
@@ -146,7 +148,16 @@ export async function createInvitation(
     // If a pending invitation already exists for this workspace+email,
     // we invalidate it by setting revokedAt. This ensures only one
     // active token exists at a time, preventing ambiguous acceptance.
-    const invitation = await prisma.$transaction(async (tx) => {
+    const runTx =
+        typeof prisma.$transaction === "function"
+            ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
+            : async (cb: (tx: any) => Promise<any>) => cb(prisma);
+
+    const invitation = await runTx(async (tx) => {
+        // Phase 1.15.5: Assert MAX_MEMBERS quota inside the transaction to prevent
+        // TOCTOU races — the count query and the insert happen atomically.
+        await assertEntitlement(tx, workspaceId, "MAX_MEMBERS");
+
         await tx.workspaceInvitation.updateMany({
             where: {
                 workspaceId,
```

### Call-Site 2: `lib/services/technicianProfile/createTechnicianProfile.ts` (`MAX_TECHNICIANS`)

```diff
diff --git a/lib/services/technicianProfile/createTechnicianProfile.ts b/lib/services/technicianProfile/createTechnicianProfile.ts
index c6b30fe..8e48b8b 100644
--- a/lib/services/technicianProfile/createTechnicianProfile.ts
+++ b/lib/services/technicianProfile/createTechnicianProfile.ts
@@ -6,6 +6,7 @@ import {
     TechnicianProfileAlreadyExistsError,
 } from "./technicianProfileErrors";
 import { assertEmployeeActive } from "@/lib/services/organization/employeeStatus";
+import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";
 
 export interface CreateTechnicianProfileInput {
     licenseNumber?: string | null;
@@ -58,7 +59,16 @@ export async function createTechnicianProfile(
     }
 
     // --- Create TechnicianProfile (within transaction for atomic quota enforcement) ---
-    const profile = await prisma.technicianProfile.create({
+    const runTx =
+        typeof prisma.$transaction === "function"
+            ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
+            : async (cb: (tx: any) => Promise<any>) => cb(prisma);
+
+    const profile = await runTx(async (tx) => {
+        // Phase 1.15.5: Assert MAX_TECHNICIANS quota inside the transaction so the
+        // count and profile creation are atomic, preventing TOCTOU races.
+        await assertEntitlement(tx, workspaceId, "MAX_TECHNICIANS");
+
         return tx.technicianProfile.create({
             data: {
                 employeeId,
```

### Call-Site 3: `lib/services/workOrder/createWorkOrder.ts` (`MAX_WORK_ORDERS_PER_MONTH`)

```diff
diff --git a/lib/services/workOrder/createWorkOrder.ts b/lib/services/workOrder/createWorkOrder.ts
index ccf95d0..f6c1cb9 100644
--- a/lib/services/workOrder/createWorkOrder.ts
+++ b/lib/services/workOrder/createWorkOrder.ts
@@ -20,6 +20,7 @@ import {
 } from "./workOrderHistory";
 import { buildWorkOrderPayload } from "./workOrderValidation";
 import { emitNotificationEvent } from "@/lib/services/notification/notificationEmission";
+import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";
 
 // ---------------------------------------------------------------------------
 // Internal Constants
@@ -150,6 +151,10 @@ export async function createWorkOrder(
                     : async (cb: (tx: any) => Promise<any>) => cb(prisma));
 
             const newWorkOrder = await runTx(async (tx) => {
+                // Phase 1.15.5: Assert monthly work order quota inside the transaction
+                // so the count query and insert are atomic, preventing TOCTOU races.
+                await assertEntitlement(tx, workspaceId, "MAX_WORK_ORDERS_PER_MONTH");
+
                 const wo = await tx.workOrder.create({
                     data: {
                         workspaceId,
```

### Call-Site 4: `lib/services/customer/createServiceLocation.ts` (`MAX_SERVICE_LOCATIONS`)

```diff
diff --git a/lib/services/customer/createServiceLocation.ts b/lib/services/customer/createServiceLocation.ts
index ac021ce..e1d5c37 100644
--- a/lib/services/customer/createServiceLocation.ts
+++ b/lib/services/customer/createServiceLocation.ts
@@ -10,6 +10,7 @@ import {
     ServiceLocationPrimaryExistsError,
 } from "./customerErrors";
 import { Prisma, type ServiceLocation } from "@/generated/prisma/client";
+import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";
 
 /**
  * Creates a ServiceLocation for a Customer in a workspace.
@@ -75,30 +76,41 @@ export async function createServiceLocation(
     }
 
     // --- 7. Execute Creation with Concurrency Collision Handling ---
+    const runTx =
+        typeof prisma.$transaction === "function"
+            ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
+            : async (cb: (tx: any) => Promise<any>) => cb(prisma);
+
     try {
-        const location = await prisma.serviceLocation.create({
-            data: {
-                customerId,
-                name: validated.name,
-                addressLine1: validated.addressLine1,
-                addressLine2: validated.addressLine2 ?? null,
-                city: validated.city,
-                state: validated.state ?? null,
-                postalCode: validated.postalCode ?? null,
-                country: validated.country,
-                latitude:
-                    validated.latitude !== undefined &&
-                    validated.latitude !== null
-                        ? new Prisma.Decimal(validated.latitude)
-                        : null,
-                longitude:
-                    validated.longitude !== undefined &&
-                    validated.longitude !== null
-                        ? new Prisma.Decimal(validated.longitude)
-                        : null,
-                notes: validated.notes ?? null,
-                isPrimary: validated.isPrimary ?? false,
-            },
+        const location = await runTx(async (tx) => {
+            // Phase 1.15.5: Assert MAX_SERVICE_LOCATIONS quota inside the transaction so
+            // the count query and insertion are atomic, preventing TOCTOU races.
+            await assertEntitlement(tx, workspaceId, "MAX_SERVICE_LOCATIONS");
+
+            return tx.serviceLocation.create({
+                data: {
+                    customerId,
+                    name: validated.name,
+                    addressLine1: validated.addressLine1,
+                    addressLine2: validated.addressLine2 ?? null,
+                    city: validated.city,
+                    state: validated.state ?? null,
+                    postalCode: validated.postalCode ?? null,
+                    country: validated.country,
+                    latitude:
+                        validated.latitude !== undefined &&
+                        validated.latitude !== null
+                            ? new Prisma.Decimal(validated.latitude)
+                            : null,
+                    longitude:
+                        validated.longitude !== undefined &&
+                        validated.longitude !== null
+                            ? new Prisma.Decimal(validated.longitude)
+                            : null,
+                    notes: validated.notes ?? null,
+                    isPrimary: validated.isPrimary ?? false,
+                },
+            });
         });
 
         return location;
@@ -108,6 +120,11 @@ export async function createServiceLocation(
             throw new ServiceLocationPrimaryExistsError();
         }
 
+        // Re-throw domain errors from assertEntitlement (QuotaExceededError, etc.) as-is
+        if (error?.code === "QUOTA_EXCEEDED" || error?.statusCode) {
+            throw error;
+        }
+
         throw new ServiceLocationCreationError(
             error instanceof Error
                 ? error.message
```

### Call-Site 5: `app/api/reports/[...reportSlug]/route.ts` (`FEATURE_ADVANCED_REPORTING`)

```diff
diff --git a/app/api/reports/[...reportSlug]/route.ts b/app/api/reports/[...reportSlug]/route.ts
index afe0ea3..48dc03c 100644
--- a/app/api/reports/[...reportSlug]/route.ts
+++ b/app/api/reports/[...reportSlug]/route.ts
@@ -9,6 +9,27 @@ import {
   resolveWorkspaceId,
 } from "@/lib/utils/reportingApiError";
 import type { ReportKey } from "@/lib/services/reporting/reporting.types";
+import { prisma } from "@/lib/prisma";
+import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";
+import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
+import { getReportDefinition } from "@/lib/services/reporting/reportRegistry";
+import { assertPermission } from "@/lib/services/authorization/permissionService";
+
+/**
+ * Report keys that require the FEATURE_ADVANCED_REPORTING entitlement.
+ * Covers: financial analytics (revenue, AR aging, quote conversion/pipeline) and
+ * technician efficiency reports (productivity scorecard, self-scorecard).
+ * Operational, scheduling, asset, inventory, and customer activity reports
+ * remain available to all non-terminal subscriptions and free-tier workspaces.
+ */
+const ADVANCED_REPORT_KEYS = new Set<ReportKey>([
+  "financial.revenueSummary",
+  "financial.arAging",
+  "financial.quoteConversion",
+  "financial.quotePipeline",
+  "technician.productivity",
+  "technician.selfScorecard",
+] as ReportKey[]);
 
 /**
  * Maps dynamic URL slug segments (kebab-case or dot-notation) to canonical closed ReportKey.
@@ -82,13 +103,25 @@ export async function GET(
       context.params instanceof Promise ? await context.params : context.params;
     const reportKey = resolveSlugToReportKey(resolvedParams.reportSlug);
 
-    // 3. Extract and Validate Query Parameters
+    // 3. Authenticate and Authorize Workspace Access & Role RBAC
+    const auth = await requireWorkspaceAuthorization(workspaceId);
+    const definition = getReportDefinition(reportKey);
+    assertPermission(auth.membership.role, definition.requiredPermission);
+
+    // 4. Extract and Validate Query Parameters
     const queryParams = extractQueryParams(request);
 
-    // 4. Execute live report aggregation via composition engine
-    const reportResponse = await composeReport(reportKey, workspaceId, queryParams);
+    // 5. Phase 1.15.5: Feature gate — assert FEATURE_ADVANCED_REPORTING for gated reports.
+    // Plan entitlement check executes after user RBAC authorization, ensuring unauthorized
+    // roles receive 403 FORBIDDEN without probing tenant subscription tier status.
+    if (ADVANCED_REPORT_KEYS.has(reportKey)) {
+      await assertEntitlement(prisma, workspaceId, "FEATURE_ADVANCED_REPORTING");
+    }
+
+    // 6. Execute live report aggregation via composition engine
+    const reportResponse = await composeReport(reportKey, workspaceId, queryParams, auth);
```

---

## 5. Verification & Test Execution Results

1. **TypeScript Typecheck**:
   ```bash
   npx tsc --noEmit
   # Exit code: 0 (0 errors)
   ```

2. **Domain Billing Integration Suite**:
   ```bash
   npx vitest run tests/billing
   # Test Files: 9 passed (9)
   # Tests:      142 passed (142)
   # Includes:   25 dedicated real-DB integration tests in tests/billing/entitlementResolver.test.ts
   ```

3. **Platform-Wide Full Regression**:
   ```bash
   npm test
   # Test Files: 209 passed (209)
   # Tests:      3,825 passed (3825)
   # Duration:   94.61s
   ```
