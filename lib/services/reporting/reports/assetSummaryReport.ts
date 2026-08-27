import { prisma } from "@/lib/prisma";
import { composeReport } from "../reportEngine";
import { registerReportExecutor } from "../reportRegistry";
import { ASSET_WARRANTY_WINDOW_DAYS } from "../reportingConstants";
import type {
  ReportCustomExecutor,
  ReportKey,
  ReportQueryContext,
  ReportResponse,
  UnscopedReportDb,
} from "../reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Custom Query Executor for Asset Summary Report (Phase 1.14.8 Engine Migration).
 */
export const assetSummaryExecutor: ReportCustomExecutor = async (
  ctx: ReportQueryContext,
) => {
  const isScalars = ctx.requestedDimensions.length === 0;
  const asOfDate = ctx.params.asOf ? new Date(String(ctx.params.asOf)) : new Date();

  // Warranty Window: [asOfDate, asOfDate + 90 days]
  const warrantyThreshold = new Date(
    asOfDate.getTime() + ASSET_WARRANTY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  interface AssetRow {
    id: string;
    categoryId: string | null;
    customerId: string | null;
    status: string;
    warrantyExpiresAt: Date | string | null;
    createdAt: Date | string;
  }

  // 1. Assets query
  const assets = await ctx.scopedDb.asset.findMany<AssetRow>({
    where: {
      ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
      ...(ctx.params.assetCategoryId ? { categoryId: String(ctx.params.assetCategoryId) } : {}),
      ...(ctx.params.assetStatus ? { status: String(ctx.params.assetStatus) } : {}),
    },
    select: {
      id: true,
      categoryId: true,
      customerId: true,
      status: true,
      warrantyExpiresAt: true,
      createdAt: true,
    },
  });

  let totalAssetCount = assets.length;
  let warrantyExpiringCount = 0;

  for (const a of assets) {
    if (a.warrantyExpiresAt) {
      const exp = new Date(a.warrantyExpiresAt);
      if (exp >= asOfDate && exp <= warrantyThreshold) {
        warrantyExpiringCount++;
      }
    }
  }

  interface ServiceWorkOrderRow {
    id: string;
    assetId: string | null;
    customerId: string | null;
    completedAt: Date | string | null;
  }

  // 2. Completed Maintenance Work Orders in Period
  const serviceWorkOrders = await ctx.scopedDb.workOrder.findMany<ServiceWorkOrderRow>({
    where: {
      status: "COMPLETED",
      assetId: { not: null },
      completedAt: {
        gte: ctx.range.startUtc,
        lt: ctx.range.endUtc,
      },
      ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
    },
    select: {
      id: true,
      assetId: true,
      customerId: true,
      completedAt: true,
    },
  });

  const serviceEventCount = serviceWorkOrders.length;
  const distinctAssetsServiced = new Set<string>();
  for (const swo of serviceWorkOrders) {
    if (swo.assetId) distinctAssetsServiced.add(swo.assetId);
  }

  const avgServicesPerAsset =
    distinctAssetsServiced.size > 0
      ? Math.round((serviceEventCount / distinctAssetsServiced.size) * 100) / 100
      : null;

  if (isScalars) {
    return {
      scalarValues: {
        "assets.count": totalAssetCount,
        "assets.warrantyExpiringCount": warrantyExpiringCount,
        "assets.serviceEventCount": serviceEventCount,
        "assets.avgServicesPerAsset": avgServicesPerAsset,
      },
    };
  }

  // Grouped rows
  const primaryDim = ctx.requestedDimensions[0];
  const groupMap = new Map<
    string,
    { count: number; warrantyExpiring: number; serviceEvents: number }
  >();

  for (const a of assets) {
    let key = "UNASSIGNED";
    if (primaryDim === "assetCategory") key = a.categoryId ?? "UNASSIGNED";
    else if (primaryDim === "assetStatus") key = a.status;
    else if (primaryDim === "customer") key = a.customerId ?? "UNASSIGNED";

    let entry = groupMap.get(key);
    if (!entry) {
      entry = { count: 0, warrantyExpiring: 0, serviceEvents: 0 };
      groupMap.set(key, entry);
    }
    entry.count++;
    if (a.warrantyExpiresAt) {
      const exp = new Date(a.warrantyExpiresAt);
      if (exp >= asOfDate && exp <= warrantyThreshold) {
        entry.warrantyExpiring++;
      }
    }
  }

  for (const swo of serviceWorkOrders) {
    let key = "UNASSIGNED";
    if (primaryDim === "customer") key = swo.customerId ?? "UNASSIGNED";
    if (primaryDim === "assetCategory") {
      const parentAsset = assets.find((a) => a.id === swo.assetId);
      key = parentAsset?.categoryId ?? "UNASSIGNED";
    }
    const entry = groupMap.get(key);
    if (entry) {
      entry.serviceEvents++;
    }
  }

  const rows = Array.from(groupMap.keys()).map((id) => {
    const e = groupMap.get(id)!;
    return {
      groupKey: id,
      values: {
        "assets.count": e.count,
        "assets.warrantyExpiringCount": e.warrantyExpiring,
        "assets.serviceEventCount": e.serviceEvents,
        "assets.avgServicesPerAsset":
          e.count > 0 ? Math.round((e.serviceEvents / e.count) * 100) / 100 : null,
      },
    };
  });

  return { rows };
};

registerReportExecutor("asset.summary", assetSummaryExecutor);

/**
 * Retrieves the Asset Summary Report via Generic Composition Engine.
 */
export async function getAssetSummaryReport(
  workspaceId: string,
  rawParams?: unknown,
  authContext?: WorkspaceAuthorizationContext,
  reportKeyOrDb?: ReportKey | UnscopedReportDb,
  passedDb?: UnscopedReportDb,
): Promise<ReportResponse> {
  const reportKey: ReportKey =
    typeof reportKeyOrDb === "string" ? reportKeyOrDb : "asset.summary";
  const db: UnscopedReportDb =
    typeof reportKeyOrDb === "object" && reportKeyOrDb !== null
      ? reportKeyOrDb
      : (passedDb ?? prisma);
  return composeReport(reportKey, workspaceId, rawParams, authContext, db);
}
