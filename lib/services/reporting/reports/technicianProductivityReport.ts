import { prisma } from "@/lib/prisma";
import {
  resolveEffectiveTechnicianScope,
  type EffectiveTechnicianScope,
  type TechnicianScopeDbHandle,
} from "../technicianScope";
import { composeReport } from "../reportEngine";
import { registerReportExecutor } from "../reportRegistry";
import {
  ReportCardinalityExceededError,
} from "../reportingErrors";
import { MAX_SCAN_ROWS } from "../reportingConstants";
import type {
  MetricKey,
  ReportCustomExecutor,
  ReportQueryContext,
  ReportResponse,
} from "../reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Custom Query Executor for Technician Productivity & Self-Scorecard (Phase 1.14.8 Engine Migration).
 */
interface WorkOrderCompletedRow {
  id: string;
  assignedTechnicianId: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  technicianTimeEntries?: Array<{
    durationMinutes?: number | null;
    startedAt?: Date | string | null;
    endedAt?: Date | string | null;
  }>;
}

interface TimeEntryRow {
  technicianProfileId: string;
  entryType: string;
  durationMinutes?: number | null;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
  status: string;
}

interface HistoryRow {
  oldValue?: string | null;
  newValue?: string | null;
}

/**
 * Custom Query Executor for Technician Productivity & Self-Scorecard Report (Phase 1.14.8 Engine Migration).
 */
export const technicianProductivityExecutor: ReportCustomExecutor = async (
  ctx: ReportQueryContext,
) => {
  const isScalars = ctx.requestedDimensions.length === 0;

  // Resolve effective technician scope (In-Query Non-Bypassable Scoping)
  const effectiveScope: EffectiveTechnicianScope = await resolveEffectiveTechnicianScope(
    ctx.workspaceId,
    ctx.auth,
    ctx.params.technicianId as string | readonly string[] | null | undefined,
    ctx.scopedDb as unknown as TechnicianScopeDbHandle,
  );

  // 1. Completed Work Orders with on-site time entries
  const completedWorkOrders = await ctx.scopedDb.workOrder.findMany<WorkOrderCompletedRow>({
    where: {
      ...effectiveScope.toWorkOrderWhere(),
      status: "COMPLETED",
      completedAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc, not: null },
    },
    select: {
      id: true,
      assignedTechnicianId: true,
      startedAt: true,
      completedAt: true,
      technicianTimeEntries: {
        where: { entryType: "ON_SITE", status: "COMPLETED" },
        select: { durationMinutes: true, startedAt: true, endedAt: true },
      },
    },
  });

  if (completedWorkOrders.length > MAX_SCAN_ROWS) {
    throw new ReportCardinalityExceededError(
      `Completed work orders count (${completedWorkOrders.length}) exceeds scan cap of ${MAX_SCAN_ROWS}.`,
    );
  }

  // 2. Cancelled Work Orders
  const cancelledGroups = await ctx.scopedDb.workOrder.groupBy({
    by: ["assignedTechnicianId"],
    where: {
      ...effectiveScope.toWorkOrderWhere(),
      status: "CANCELLED",
      cancelledAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc, not: null },
    },
    _count: { _all: true },
  });

  // 3. Completed Time Entries
  const timeEntryWhere: Record<string, unknown> = {
    ...effectiveScope.toTimeEntryWhere(),
    status: "COMPLETED",
    startedAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
  };
  if (ctx.rawFilters.timeEntryType) {
    timeEntryWhere.entryType = Array.isArray(ctx.rawFilters.timeEntryType)
      ? { in: ctx.rawFilters.timeEntryType }
      : ctx.rawFilters.timeEntryType;
  }

  const timeEntries = await ctx.scopedDb.technicianTimeEntry.findMany<TimeEntryRow>({
    where: timeEntryWhere,
    select: {
      technicianProfileId: true,
      entryType: true,
      durationMinutes: true,
      startedAt: true,
      endedAt: true,
      status: true,
    },
  });

  if (timeEntries.length > MAX_SCAN_ROWS) {
    throw new ReportCardinalityExceededError(
      `Time entries scan count (${timeEntries.length}) exceeds the maximum row scan cap of ${MAX_SCAN_ROWS}. Please narrow your date range.`,
    );
  }

  // 4. Reassignment-away events
  const reassignmentHistories = await ctx.scopedDb.workOrderHistory.findMany<HistoryRow>({
    where: {
      ...effectiveScope.toWorkOrderHistoryOldValueWhere(),
      field: "assignedTechnicianId",
      eventType: { in: ["REASSIGNED", "UNASSIGNED"] },
      createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
    },
    select: {
      oldValue: true,
      newValue: true,
    },
  });

  // Per-Technician Stats Assembly
  const techCompletedMap = new Map<string, number>();
  const techCompletedDurationMap = new Map<string, number>();

  for (const wo of completedWorkOrders) {
    const techId = wo.assignedTechnicianId;
    if (!techId) continue;
    techCompletedMap.set(techId, (techCompletedMap.get(techId) ?? 0) + 1);

    let jobOnSiteMinutes = 0;
    if (wo.technicianTimeEntries && wo.technicianTimeEntries.length > 0) {
      for (const entry of wo.technicianTimeEntries) {
        const dur =
          entry.durationMinutes ??
          (entry.startedAt && entry.endedAt
            ? Math.max(
                0,
                Math.round(
                  (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) /
                    (60 * 1000),
                ),
              )
            : 0);
        jobOnSiteMinutes += dur;
      }
    }

    techCompletedDurationMap.set(
      techId,
      (techCompletedDurationMap.get(techId) ?? 0) + jobOnSiteMinutes,
    );
  }

  const techCancelledMap = new Map<string, number>();
  for (const g of cancelledGroups) {
    const rec = g as Record<string, unknown>;
    const techId = rec.assignedTechnicianId ? String(rec.assignedTechnicianId) : null;
    if (techId) {
      const count = (rec._count as { _all?: number } | undefined)?._all ?? 0;
      techCancelledMap.set(techId, count);
    }
  }

  const techTimeStatsMap = new Map<
    string,
    {
      onSiteMinutes: number;
      travelMinutes: number;
      trackedMinutes: number;
    }
  >();

  for (const te of timeEntries) {
    const techId = te.technicianProfileId;
    const stats = techTimeStatsMap.get(techId) ?? {
      onSiteMinutes: 0,
      travelMinutes: 0,
      trackedMinutes: 0,
    };

    const dur =
      te.durationMinutes ??
      (te.startedAt && te.endedAt
        ? Math.max(
            0,
            Math.round(
              (new Date(te.endedAt).getTime() - new Date(te.startedAt).getTime()) /
                (60 * 1000),
            ),
          )
        : 0);

    stats.trackedMinutes += dur;
    if (te.entryType === "ON_SITE") {
      stats.onSiteMinutes += dur;
    } else if (te.entryType === "TRAVEL") {
      stats.travelMinutes += dur;
    }

    techTimeStatsMap.set(techId, stats);
  }

  const techReassignmentAwayMap = new Map<string, number>();
  for (const h of reassignmentHistories) {
    if (h.oldValue && h.oldValue !== h.newValue) {
      const count = techReassignmentAwayMap.get(h.oldValue) ?? 0;
      techReassignmentAwayMap.set(h.oldValue, count + 1);
    }
  }

  if (isScalars) {
    const totalCompleted = Array.from(techCompletedMap.values()).reduce((a, b) => a + b, 0);
    const totalCancelled = Array.from(techCancelledMap.values()).reduce((a, b) => a + b, 0);
    const totalCompletedDuration = Array.from(techCompletedDurationMap.values()).reduce(
      (a, b) => a + b,
      0,
    );

    let totalOnSiteMinutes = 0;
    let totalTravelMinutes = 0;
    let totalTrackedMinutes = 0;

    for (const stats of techTimeStatsMap.values()) {
      totalOnSiteMinutes += stats.onSiteMinutes;
      totalTravelMinutes += stats.travelMinutes;
      totalTrackedMinutes += stats.trackedMinutes;
    }

    const totalReassignmentAway =
      effectiveScope.technicianIds.length === 1
        ? techReassignmentAwayMap.get(effectiveScope.technicianIds[0]) ?? 0
        : Array.from(techReassignmentAwayMap.values()).reduce((a, b) => a + b, 0);

    const onSiteShareOfTrackedTime =
      totalTrackedMinutes > 0
        ? Number(((totalOnSiteMinutes / totalTrackedMinutes) * 100).toFixed(2))
        : null;
    const avgJobDurationMinutes =
      totalCompleted > 0
        ? Number((totalCompletedDuration / totalCompleted).toFixed(2))
        : null;

    const values: Record<string, string | number | null> = {
      "technicians.completedWorkOrderCount": totalCompleted,
      "technicians.cancelledWorkOrderCount": totalCancelled,
      "technicians.avgJobDurationMinutes": avgJobDurationMinutes,
      "technicians.reassignmentAwayCount": totalReassignmentAway,
      "technicians.onSiteMinutes": totalOnSiteMinutes,
      "technicians.travelMinutes": totalTravelMinutes,
      "technicians.trackedMinutes": totalTrackedMinutes,
      "technicians.onSiteShareOfTrackedTime": onSiteShareOfTrackedTime,
    };

    return {
      scalarValues: values,
    };
  }

  // Dimensional grouping mode (By Technician)
  const qualifyingProfiles = await ctx.scopedDb.technicianProfile.findMany<{ id: string }>({
    where: effectiveScope.toTechnicianProfileWhere(),
    select: { id: true },
  });

  const allTechIdSet = new Set<string>();
  for (const p of qualifyingProfiles) allTechIdSet.add(p.id);
  for (const id of techCompletedMap.keys()) allTechIdSet.add(id);
  for (const id of techTimeStatsMap.keys()) allTechIdSet.add(id);

  const resultRows = [];
  for (const techId of Array.from(allTechIdSet)) {
    const completed = techCompletedMap.get(techId) ?? 0;
    const cancelled = techCancelledMap.get(techId) ?? 0;
    const completedDuration = techCompletedDurationMap.get(techId) ?? 0;
    const timeStats = techTimeStatsMap.get(techId) ?? {
      onSiteMinutes: 0,
      travelMinutes: 0,
      trackedMinutes: 0,
    };
    const reassignedAway = techReassignmentAwayMap.get(techId) ?? 0;

    const onSiteShareOfTrackedTime =
      timeStats.trackedMinutes > 0
        ? Number(((timeStats.onSiteMinutes / timeStats.trackedMinutes) * 100).toFixed(2))
        : null;

    const avgJobDurationMinutes =
      completed > 0 ? Number((completedDuration / completed).toFixed(2)) : null;

    resultRows.push({
      groupKey: techId,
      values: {
        "technicians.completedWorkOrderCount": completed,
        "technicians.cancelledWorkOrderCount": cancelled,
        "technicians.avgJobDurationMinutes": avgJobDurationMinutes,
        "technicians.reassignmentAwayCount": reassignedAway,
        "technicians.onSiteMinutes": timeStats.onSiteMinutes,
        "technicians.travelMinutes": timeStats.travelMinutes,
        "technicians.trackedMinutes": timeStats.trackedMinutes,
        "technicians.onSiteShareOfTrackedTime": onSiteShareOfTrackedTime,
      },
    });
  }

  return { rows: resultRows };
};

registerReportExecutor("technician.productivity", technicianProductivityExecutor);
registerReportExecutor("technician.selfScorecard", technicianProductivityExecutor);

/**
 * Retrieves the Technician Productivity & Performance Report (or Self-Scorecard) via Generic Composition Engine.
 */
export async function getTechnicianProductivityReport(
  workspaceId: string,
  rawParams?: unknown,
  actor?: WorkspaceAuthorizationContext,
  reportKey: "technician.productivity" | "technician.selfScorecard" = "technician.productivity",
  db = prisma,
): Promise<ReportResponse> {
  return composeReport(reportKey, workspaceId, rawParams, actor, db);
}
