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
 * Custom Query Executor for Scheduling & Dispatch Performance Report (Phase 1.14.8 Engine Migration).
 */
export const dispatchPerformanceExecutor: ReportCustomExecutor = async (
  ctx: ReportQueryContext,
) => {
  const isScalars = ctx.requestedDimensions.length === 0;

  if (isScalars) {
    const [scheduledCount, completedCount, cancelledCount, dispatchedCount] =
      await Promise.all([
        ctx.scopedDb.scheduleAppointment.count({
          where: {
            ...ctx.baseWhere,
            createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
          },
        }),
        ctx.scopedDb.scheduleAppointment.count({
          where: {
            ...ctx.baseWhere,
            history: {
              some: {
                eventType: "COMPLETED",
                createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
              },
            },
          },
        }),
        ctx.scopedDb.scheduleAppointment.count({
          where: {
            ...ctx.baseWhere,
            history: {
              some: {
                eventType: "CANCELLED",
                createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
              },
            },
          },
        }),
        ctx.scopedDb.scheduleAppointment.count({
          where: {
            ...ctx.baseWhere,
            history: {
              some: {
                eventType: "DISPATCHED",
                createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
              },
            },
          },
        }),
      ]);

    let avgDispatchLatencyMinutes: number | null = null;
    if (ctx.requestedMetrics.includes("schedule.avgDispatchLatencyMinutes")) {
      if (dispatchedCount > MAX_SCAN_ROWS) {
        throw new ReportCardinalityExceededError(
          `The matched dispatched appointments (${dispatchedCount}) exceeds the maximum row scan cap of ${MAX_SCAN_ROWS} for dispatch latency calculation. Please narrow the reporting date range or add filters.`,
        );
      }

      if (dispatchedCount > 0) {
        const rows = await ctx.scopedDb.scheduleAppointment.findMany({
          where: {
            ...ctx.baseWhere,
            history: {
              some: {
                eventType: "DISPATCHED",
                createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
              },
            },
          },
          select: {
            createdAt: true,
            history: {
              where: {
                eventType: "DISPATCHED",
                createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
              },
              select: { createdAt: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        });

        let totalMinutes = 0;
        let validRows = 0;
        for (const row of rows) {
          const r = row as unknown as {
            createdAt: string | Date;
            history?: Array<{ createdAt: string | Date }>;
          };
          const dispatchEventTime = r.history?.[0]?.createdAt;
          if (r.createdAt && dispatchEventTime) {
            const diffMs =
              new Date(dispatchEventTime).getTime() - new Date(r.createdAt).getTime();
            totalMinutes += diffMs / (60 * 1000);
            validRows += 1;
          }
        }
        avgDispatchLatencyMinutes =
          validRows > 0 ? Number((totalMinutes / validRows).toFixed(2)) : null;
      } else {
        avgDispatchLatencyMinutes = null;
      }
    }

    return {
      scalarValues: {
        "schedule.appointmentsScheduledCount": scheduledCount,
        "schedule.appointmentsCompletedCount": completedCount,
        "schedule.appointmentsCancelledCount": cancelledCount,
        "schedule.dispatchedCount": dispatchedCount,
        "schedule.avgDispatchLatencyMinutes": avgDispatchLatencyMinutes,
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

  const groupByField: Prisma.ScheduleAppointmentScalarFieldEnum =
    primaryDimensionKey === "technician"
      ? ("technicianId" as Prisma.ScheduleAppointmentScalarFieldEnum)
      : (dimDef.groupByField as Prisma.ScheduleAppointmentScalarFieldEnum);

  const [scheduledGroups, completedGroups, cancelledGroups, dispatchedGroups] =
    await Promise.all([
      ctx.scopedDb.scheduleAppointment.groupBy({
        by: [groupByField],
        where: {
          ...ctx.baseWhere,
          createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
        },
        _count: { _all: true },
      }),
      ctx.scopedDb.scheduleAppointment.groupBy({
        by: [groupByField],
        where: {
          ...ctx.baseWhere,
          history: {
            some: {
              eventType: "COMPLETED",
              createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
            },
          },
        },
        _count: { _all: true },
      }),
      ctx.scopedDb.scheduleAppointment.groupBy({
        by: [groupByField],
        where: {
          ...ctx.baseWhere,
          history: {
            some: {
              eventType: "CANCELLED",
              createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
            },
          },
        },
        _count: { _all: true },
      }),
      ctx.scopedDb.scheduleAppointment.groupBy({
        by: [groupByField],
        where: {
          ...ctx.baseWhere,
          history: {
            some: {
              eventType: "DISPATCHED",
              createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
            },
          },
        },
        _count: { _all: true },
      }),
    ]);

  const groupKeySet = new Set<string>();
  const scheduledMap = new Map<string, number>();
  const completedMap = new Map<string, number>();
  const cancelledMap = new Map<string, number>();
  const dispatchedMap = new Map<string, number>();

  for (const g of scheduledGroups) {
    const rec = g as Record<string, unknown>;
    const k = String(rec[groupByField] ?? "UNASSIGNED");
    groupKeySet.add(k);
    const countVal = (rec._count as { _all?: number } | undefined)?._all ?? 0;
    scheduledMap.set(k, countVal);
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
  for (const g of dispatchedGroups) {
    const rec = g as Record<string, unknown>;
    const k = String(rec[groupByField] ?? "UNASSIGNED");
    groupKeySet.add(k);
    const countVal = (rec._count as { _all?: number } | undefined)?._all ?? 0;
    dispatchedMap.set(k, countVal);
  }

  const groupLatencyMap = new Map<string, number | null>();
  if (ctx.requestedMetrics.includes("schedule.avgDispatchLatencyMinutes")) {
    const totalDispatchedRows = Array.from(dispatchedMap.values()).reduce(
      (a, b) => a + b,
      0,
    );
    if (totalDispatchedRows > MAX_SCAN_ROWS) {
      throw new ReportCardinalityExceededError(
        `The total matched dispatched rows (${totalDispatchedRows}) exceeds the maximum row scan cap of ${MAX_SCAN_ROWS} for dispatch latency calculation. Narrow the date range or add filters.`,
      );
    }

    if (totalDispatchedRows > 0) {
      const rows = await ctx.scopedDb.scheduleAppointment.findMany({
        where: {
          ...ctx.baseWhere,
          history: {
            some: {
              eventType: "DISPATCHED",
              createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
            },
          },
        },
        select: {
          [groupByField]: true,
          createdAt: true,
          history: {
            where: {
              eventType: "DISPATCHED",
              createdAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
            },
            select: { createdAt: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      });

      const groupStats = new Map<string, { count: number; totalMinutes: number }>();
      for (const r of rows) {
        const row = r as unknown as {
          createdAt?: string | Date | null;
          history?: Array<{ createdAt: string | Date }>;
          [key: string]: unknown;
        };
        const k = String(row[groupByField] ?? "UNASSIGNED");
        const dispatchEventTime = row.history?.[0]?.createdAt;
        if (row.createdAt && dispatchEventTime) {
          const diffMs =
            new Date(dispatchEventTime).getTime() - new Date(row.createdAt).getTime();
          const prev = groupStats.get(k) ?? { count: 0, totalMinutes: 0 };
          groupStats.set(k, {
            count: prev.count + 1,
            totalMinutes: prev.totalMinutes + diffMs / (60 * 1000),
          });
        }
      }

      for (const groupKey of Array.from(groupKeySet)) {
        const stats = groupStats.get(groupKey);
        groupLatencyMap.set(
          groupKey,
          stats && stats.count > 0
            ? Number((stats.totalMinutes / stats.count).toFixed(2))
            : null,
        );
      }
    } else {
      for (const groupKey of Array.from(groupKeySet)) {
        groupLatencyMap.set(groupKey, null);
      }
    }
  }

  const resultRows = [];
  for (const groupKey of Array.from(groupKeySet)) {
    const scheduled = scheduledMap.get(groupKey) ?? 0;
    const completed = completedMap.get(groupKey) ?? 0;
    const cancelled = cancelledMap.get(groupKey) ?? 0;
    const dispatched = dispatchedMap.get(groupKey) ?? 0;
    const latency = groupLatencyMap.get(groupKey) ?? null;

    resultRows.push({
      groupKey,
      values: {
        "schedule.appointmentsScheduledCount": scheduled,
        "schedule.appointmentsCompletedCount": completed,
        "schedule.appointmentsCancelledCount": cancelled,
        "schedule.dispatchedCount": dispatched,
        "schedule.avgDispatchLatencyMinutes": latency,
      },
    });
  }

  return { rows: resultRows };
};

registerReportExecutor("scheduling.dispatchPerformance", dispatchPerformanceExecutor);

/**
 * Retrieves the Scheduling & Dispatch Performance Report via Generic Composition Engine.
 */
export async function getDispatchPerformanceReport(
  workspaceId: string,
  rawParams?: unknown,
  actor?: WorkspaceAuthorizationContext,
  db = prisma,
): Promise<ReportResponse> {
  return composeReport("scheduling.dispatchPerformance", workspaceId, rawParams, actor, db);
}
