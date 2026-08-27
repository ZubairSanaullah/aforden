import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { composeReport } from "../reportEngine";
import { registerReportExecutor } from "../reportRegistry";
import type {
  ReportCustomExecutor,
  ReportKey,
  ReportQueryContext,
  ReportResponse,
  UnscopedReportDb,
} from "../reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

const ZERO_2DP = new Prisma.Decimal("0.00");

interface QuoteRow {
  id: string;
  customerId: string | null;
  status: string;
  total?: Prisma.Decimal | number | string | null;
  createdAt: Date | string;
}

/**
 * Custom Query Executor for Quote Conversion Report (Phase 1.14.8 Engine Migration).
 */
export const quoteConversionExecutor: ReportCustomExecutor = async (
  ctx: ReportQueryContext,
) => {
  const isScalars = ctx.requestedDimensions.length === 0;

  // 1. Period Quotes (created in period) via strictly scoped DB
  const quoteWhere: Record<string, unknown> = {
    createdAt: {
      gte: ctx.range.startUtc,
      lt: ctx.range.endUtc,
    },
    ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
  };
  if (ctx.rawFilters.quoteStatus) {
    quoteWhere.status = Array.isArray(ctx.rawFilters.quoteStatus)
      ? { in: ctx.rawFilters.quoteStatus }
      : ctx.rawFilters.quoteStatus;
  }

  const quotes = await ctx.scopedDb.quote.findMany<QuoteRow>({
    where: quoteWhere,
    select: {
      id: true,
      customerId: true,
      status: true,
      total: true,
      createdAt: true,
    },
  });

  let createdCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let approvedTotal = ZERO_2DP;
  let pipelineTotal = ZERO_2DP;

  for (const q of quotes) {
    createdCount++;
    const tot = new Prisma.Decimal((q.total as string | number) ?? 0);
    if (q.status === "APPROVED") {
      approvedCount++;
      approvedTotal = approvedTotal.add(tot);
    } else if (q.status === "REJECTED") {
      rejectedCount++;
    } else if (q.status === "PENDING" || q.status === "DRAFT") {
      pipelineTotal = pipelineTotal.add(tot);
    }
  }

  const winRate =
    createdCount > 0
      ? Math.round((approvedCount / createdCount) * 10000) / 100
      : null;

  if (isScalars) {
    return {
      scalarValues: {
        "quotes.createdCount": createdCount,
        "quotes.approvedCount": approvedCount,
        "quotes.rejectedCount": rejectedCount,
        "quotes.approvedTotal": approvedTotal.toFixed(2),
        "quotes.pipelineTotal": pipelineTotal.toFixed(2),
        "quotes.winRate": winRate,
      },
    };
  }

  // Grouped rows (e.g. by customer)
  const groupMap = new Map<
    string,
    {
      created: number;
      approved: number;
      rejected: number;
      approvedTot: Prisma.Decimal;
      pipelineTot: Prisma.Decimal;
    }
  >();

  for (const q of quotes) {
    const key = q.customerId ?? "UNASSIGNED";
    let entry = groupMap.get(key);
    if (!entry) {
      entry = {
        created: 0,
        approved: 0,
        rejected: 0,
        approvedTot: ZERO_2DP,
        pipelineTot: ZERO_2DP,
      };
      groupMap.set(key, entry);
    }
    entry.created++;
    const tot = new Prisma.Decimal((q.total as string | number) ?? 0);
    if (q.status === "APPROVED") {
      entry.approved++;
      entry.approvedTot = entry.approvedTot.add(tot);
    } else if (q.status === "REJECTED") {
      entry.rejected++;
    } else if (q.status === "PENDING" || q.status === "DRAFT") {
      entry.pipelineTot = entry.pipelineTot.add(tot);
    }
  }

  const rows = Array.from(groupMap.keys()).map((k) => {
    const e = groupMap.get(k)!;
    const rate =
      e.created > 0
        ? Math.round((e.approved / e.created) * 10000) / 100
        : null;
    return {
      groupKey: k,
      values: {
        "quotes.createdCount": e.created,
        "quotes.approvedCount": e.approved,
        "quotes.rejectedCount": e.rejected,
        "quotes.approvedTotal": e.approvedTot.toFixed(2),
        "quotes.pipelineTotal": e.pipelineTot.toFixed(2),
        "quotes.winRate": rate,
      },
    };
  });

  return { rows };
};

registerReportExecutor("financial.quoteConversion", quoteConversionExecutor);

/**
 * Retrieves the Quote Conversion Report via Generic Composition Engine.
 */
export async function getQuoteConversionReport(
  workspaceId: string,
  rawParams?: unknown,
  authContext?: WorkspaceAuthorizationContext,
  reportKeyOrDb?: ReportKey | UnscopedReportDb,
  passedDb?: UnscopedReportDb,
): Promise<ReportResponse> {
  const reportKey: ReportKey =
    typeof reportKeyOrDb === "string" ? reportKeyOrDb : "financial.quoteConversion";
  const db: UnscopedReportDb =
    typeof reportKeyOrDb === "object" && reportKeyOrDb !== null
      ? reportKeyOrDb
      : (passedDb ?? prisma);
  return composeReport(reportKey, workspaceId, rawParams, authContext, db);
}
