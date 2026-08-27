import { prisma } from "@/lib/prisma";
import { getDimensionDefinition } from "../dimensionRegistry";
import { composeReport } from "../reportEngine";
import { registerReportExecutor } from "../reportRegistry";
import { UnsupportedMetricDimensionCombinationError } from "../reportingErrors";
import type {
  ReportCustomExecutor,
  ReportQueryContext,
  ReportResponse,
} from "../reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Custom Query Executor for Work Order Volume Report (Phase 1.14.8 Engine Migration).
 * Executes counts and group-by aggregations within strict workspace scope.
 */
export const workOrderVolumeExecutor: ReportCustomExecutor = async (
  ctx: ReportQueryContext,
) => {
  const isScalars = ctx.requestedDimensions.length === 0;

  if (isScalars) {
    const [createdCount, completedCount, cancelledCount] = await Promise.all([
      ctx.scopedDb.workOrder.count({
        where: {
          ...ctx.baseWhere,
          createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
        },
      }),
      ctx.scopedDb.workOrder.count({
        where: {
          ...ctx.baseWhere,
          status: "COMPLETED",
          completedAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
        },
      }),
      ctx.scopedDb.workOrder.count({
        where: {
          ...ctx.baseWhere,
          status: "CANCELLED",
          cancelledAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
        },
      }),
    ]);

    const completionRate =
      createdCount > 0
        ? Number(((completedCount / createdCount) * 100).toFixed(2))
        : null; // divide-by-zero -> null

    return {
      scalarValues: {
        "workOrders.createdCount": createdCount,
        "workOrders.completedCount": completedCount,
        "workOrders.cancelledCount": cancelledCount,
        "workOrders.completionRate": completionRate,
      },
    };
  }

  // Grouped mode
  const primaryDimensionKey = ctx.requestedDimensions[0];
  const dimDef = getDimensionDefinition(primaryDimensionKey);

  if (!dimDef.groupByField) {
    throw new UnsupportedMetricDimensionCombinationError(
      `Time series bucketing is handled in Phase 1.14.8.`,
    );
  }

  const groupByField = dimDef.groupByField as Prisma.WorkOrderScalarFieldEnum;

  const [createdGroups, completedGroups, cancelledGroups] = await Promise.all([
    ctx.scopedDb.workOrder.groupBy({
      by: [groupByField],
      where: {
        ...ctx.baseWhere,
        createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
      },
      _count: { _all: true },
    }),
    ctx.scopedDb.workOrder.groupBy({
      by: [groupByField],
      where: {
        ...ctx.baseWhere,
        status: "COMPLETED",
        completedAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
      },
      _count: { _all: true },
    }),
    ctx.scopedDb.workOrder.groupBy({
      by: [groupByField],
      where: {
        ...ctx.baseWhere,
        status: "CANCELLED",
        cancelledAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
      },
      _count: { _all: true },
    }),
  ]);

  const groupKeySet = new Set<string>();
  const createdMap = new Map<string, number>();
  const completedMap = new Map<string, number>();
  const cancelledMap = new Map<string, number>();

  for (const g of createdGroups) {
    const rec = g as Record<string, unknown>;
    const k = String(rec[groupByField] ?? "UNASSIGNED");
    groupKeySet.add(k);
    const countVal = (rec._count as { _all?: number } | undefined)?._all ?? 0;
    createdMap.set(k, countVal);
  }
  for (const g of completedGroups) {
    const rec = g as Record<string, unknown>;
    const k = String(rec[groupByField] ?? "UNASSIGNED");
    groupKeySet.add(k);
    const countVal = (rec._count as { _all?: number } | undefined)?._all ?? 0;
    completedMap.set(k, countVal);
  }
  for (const g of cancelledGroups) {
    const rec = g as Record<string, unknown>;
    const k = String(rec[groupByField] ?? "UNASSIGNED");
    groupKeySet.add(k);
    const countVal = (rec._count as { _all?: number } | undefined)?._all ?? 0;
    cancelledMap.set(k, countVal);
  }

  const rows = [];
  for (const groupKey of Array.from(groupKeySet)) {
    const created = createdMap.get(groupKey) ?? 0;
    const completed = completedMap.get(groupKey) ?? 0;
    const cancelled = cancelledMap.get(groupKey) ?? 0;
    const rate = created > 0 ? Number(((completed / created) * 100).toFixed(2)) : null;

    rows.push({
      groupKey,
      values: {
        "workOrders.createdCount": created,
        "workOrders.completedCount": completed,
        "workOrders.cancelledCount": cancelled,
        "workOrders.completionRate": rate,
      },
    });
  }

  return { rows };
};

registerReportExecutor("operational.workOrderVolume", workOrderVolumeExecutor);

/**
 * Retrieves the Work Order Volume Report via Generic Composition Engine.
 */
export async function getWorkOrderVolumeReport(
  workspaceId: string,
  rawParams?: unknown,
  actor?: WorkspaceAuthorizationContext,
  db = prisma,
): Promise<ReportResponse> {
  return composeReport("operational.workOrderVolume", workspaceId, rawParams, actor, db);
}
