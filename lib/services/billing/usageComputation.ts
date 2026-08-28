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
