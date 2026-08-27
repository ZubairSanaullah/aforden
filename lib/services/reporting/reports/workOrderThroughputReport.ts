import { prisma } from "@/lib/prisma";
import { getDimensionDefinition } from "../dimensionRegistry";
import { composeReport } from "../reportEngine";
import { registerReportExecutor } from "../reportRegistry";
import {
  ReportCardinalityExceededError,
  UnsupportedMetricDimensionCombinationError,
} from "../reportingErrors";
import { MAX_SCAN_ROWS, MAX_GROUP_CARDINALITY } from "../reportingConstants";
import type {
  ReportCustomExecutor,
  ReportQueryContext,
  ReportResponse,
} from "../reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Custom Query Executor for Work Order Throughput Report (Phase 1.14.8 Engine Migration).
 */
export const workOrderThroughputExecutor: ReportCustomExecutor = async (
  ctx: ReportQueryContext,
) => {
  const isScalars = ctx.requestedDimensions.length === 0;

  const targetWhere = {
    ...ctx.baseWhere,
    status: "COMPLETED",
    completedAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
  };

  if (isScalars) {
    const completedCount = await ctx.scopedDb.workOrder.count({ where: targetWhere });

    if (completedCount > MAX_SCAN_ROWS) {
      throw new ReportCardinalityExceededError(
        `The matched completed work orders (${completedCount}) exceeds the maximum row scan cap of ${MAX_SCAN_ROWS} for cycle time calculation. Please narrow the reporting date range or add filters.`,
      );
    }

    let avgCycleTimeMinutes: number | null = null;
    if (completedCount > 0) {
      const rows = await ctx.scopedDb.workOrder.findMany<{
        createdAt: Date | string | null;
        completedAt: Date | string | null;
      }>({
        where: targetWhere,
        select: { createdAt: true, completedAt: true },
      });

      let totalMinutes = 0;
      let validRows = 0;
      for (const row of rows) {
        if (row.createdAt && row.completedAt) {
          const diffMs =
            new Date(row.completedAt).getTime() - new Date(row.createdAt).getTime();
          totalMinutes += diffMs / (60 * 1000);
          validRows += 1;
        }
      }
      avgCycleTimeMinutes = validRows > 0 ? Number((totalMinutes / validRows).toFixed(2)) : null;
    }

    return {
      scalarValues: {
        "workOrders.completedCount": completedCount,
        "workOrders.avgCycleTimeMinutes": avgCycleTimeMinutes,
      },
    };
  }

  // Dimensional grouping mode
  const primaryDimensionKey = ctx.requestedDimensions[0];
  const dimDef = getDimensionDefinition(primaryDimensionKey);

  if (!dimDef.groupByField) {
    throw new UnsupportedMetricDimensionCombinationError(
      `Time series bucketing is handled in Phase 1.14.8.`,
    );
  }

  const groupByField = dimDef.groupByField as Prisma.WorkOrderScalarFieldEnum;

  const completedGroups = await ctx.scopedDb.workOrder.groupBy({
    by: [groupByField],
    where: targetWhere,
    _count: { _all: true },
  });

  const totalMatchedRows = completedGroups.reduce(
    (acc: number, g: unknown) =>
      acc + (((g as Record<string, unknown>)._count as { _all?: number } | undefined)?._all ?? 0),
    0,
  );
  if (totalMatchedRows > MAX_SCAN_ROWS) {
    throw new ReportCardinalityExceededError(
      `The total matched rows (${totalMatchedRows}) exceeds the maximum row scan cap of ${MAX_SCAN_ROWS} for cycle time calculation. Narrow the date range or add filters.`,
    );
  }

  const rows = await ctx.scopedDb.workOrder.findMany({
    where: targetWhere,
    select: {
      [groupByField]: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const groupStats = new Map<string, { count: number; totalMinutes: number }>();
  for (const g of completedGroups) {
    const rec = g as Record<string, unknown>;
    const k = String(rec[groupByField] ?? "UNASSIGNED");
    const countVal = (rec._count as { _all?: number } | undefined)?._all ?? 0;
    groupStats.set(k, { count: countVal, totalMinutes: 0 });
  }

  for (const r of rows) {
    const row = r as unknown as {
      createdAt?: Date | null;
      completedAt?: Date | null;
      [key: string]: unknown;
    };
    const k = String(row[groupByField] ?? "UNASSIGNED");
    if (row.createdAt && row.completedAt) {
      const diffMs = new Date(row.completedAt).getTime() - new Date(row.createdAt).getTime();
      const stats = groupStats.get(k);
      if (stats) {
        stats.totalMinutes += diffMs / (60 * 1000);
      }
    }
  }

  const resultRows = [];
  for (const [groupKey, stats] of groupStats.entries()) {
    const avg = stats.count > 0 ? Number((stats.totalMinutes / stats.count).toFixed(2)) : null;

    resultRows.push({
      groupKey,
      values: {
        "workOrders.completedCount": stats.count,
        "workOrders.avgCycleTimeMinutes": avg,
      },
    });
  }

  return { rows: resultRows };
};

registerReportExecutor("operational.workOrderThroughput", workOrderThroughputExecutor);

/**
 * Retrieves the Work Order Throughput Report via Generic Composition Engine.
 */
export async function getWorkOrderThroughputReport(
  workspaceId: string,
  rawParams?: unknown,
  actor?: WorkspaceAuthorizationContext,
  db = prisma,
): Promise<ReportResponse> {
  return composeReport("operational.workOrderThroughput", workspaceId, rawParams, actor, db);
}
