import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { composeReport } from "../reportEngine";
import { registerReportExecutor } from "../reportRegistry";
import { reportQueryParamsSchema } from "../reporting.schemas";
import {
  ReportCardinalityExceededError,
  ReportMetricUnavailableError,
  ReportParameterValidationError,
} from "../reportingErrors";
import { HISTORICAL_AGING_TOLERANCE_MS } from "../reportingConstants";
import type {
  ReportCustomExecutor,
  ReportKey,
  ReportQueryContext,
  ReportResponse,
  UnscopedReportDb,
} from "../reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

export const arAgingReportParamsSchema = reportQueryParamsSchema.extend({
  asOf: z.string().optional(),
  customerId: z.string().optional(),
  currencyCode: z.string().optional(),
});

export type ArAgingReportParams = z.infer<typeof arAgingReportParamsSchema>;

const ZERO_2DP = new Prisma.Decimal("0.00");

interface ArInvoiceRow {
  id: string;
  customerId: string | null;
  currencyCode: string | null;
  amountDue?: Prisma.Decimal | number | string | null;
  dueDate?: Date | string | null;
  issueDate?: Date | string | null;
}

/**
 * Custom Query Executor for Accounts Receivable (AR) Aging Report (Phase 1.14.8 Engine Migration).
 */
export const arAgingExecutor: ReportCustomExecutor = async (
  ctx: ReportQueryContext,
) => {
  const now = new Date();
  const asOfDate = ctx.params.asOf ? new Date(String(ctx.params.asOf)) : now;

  // Rule A.4: Check for past-dated historical aging requests
  if (asOfDate.getTime() < now.getTime() - HISTORICAL_AGING_TOLERANCE_MS) {
    throw new ReportMetricUnavailableError(
      `Historical as-of AR aging reconstruction (prior to current date) cannot be computed from snapshot balances: system lacks point-in-time balance snapshot ledger replay (Phase 1.14.6 constraint).`,
    );
  }

  // Query open invoices with positive balance due (amountDue > 0)
  const invoiceWhere: Record<string, unknown> = {
    status: ctx.rawFilters.invoiceStatus
      ? Array.isArray(ctx.rawFilters.invoiceStatus)
        ? { in: ctx.rawFilters.invoiceStatus }
        : ctx.rawFilters.invoiceStatus
      : { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
    amountDue: { gt: 0 },
    ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
    ...(ctx.params.currencyCode ? { currencyCode: String(ctx.params.currencyCode) } : {}),
  };

  const openInvoices = await ctx.scopedDb.invoice.findMany<ArInvoiceRow>({
    where: invoiceWhere,
    select: {
      id: true,
      customerId: true,
      currencyCode: true,
      amountDue: true,
      dueDate: true,
      issueDate: true,
    },
  });

  if (openInvoices.length > 10000) {
    throw new ReportCardinalityExceededError(
      `Open invoices scan count (${openInvoices.length}) exceeds maximum row scan cap.`,
    );
  }

  // Multi-Currency Verification
  if (!ctx.params.currencyCode) {
    const observedCurrencies = new Set<string>();
    for (const inv of openInvoices) if (inv.currencyCode) observedCurrencies.add(inv.currencyCode);
    if (observedCurrencies.size > 1) {
      throw new ReportParameterValidationError(
        `Workspace contains multiple currencies (${Array.from(observedCurrencies).join(", ")}). Specify a currencyCode filter to generate financial reports.`,
      );
    }
  }

  // Group by Customer into discrete aging buckets (Decimal arithmetic)
  const customerMap = new Map<
    string,
    {
      current: Prisma.Decimal;
      days1_30: Prisma.Decimal;
      days31_60: Prisma.Decimal;
      days61_90: Prisma.Decimal;
      days90Plus: Prisma.Decimal;
      totalOutstanding: Prisma.Decimal;
    }
  >();

  const getEntry = (cId: string | null | undefined) => {
    const key = cId ?? "UNASSIGNED";
    let entry = customerMap.get(key);
    if (!entry) {
      entry = {
        current: ZERO_2DP,
        days1_30: ZERO_2DP,
        days31_60: ZERO_2DP,
        days61_90: ZERO_2DP,
        days90Plus: ZERO_2DP,
        totalOutstanding: ZERO_2DP,
      };
      customerMap.set(key, entry);
    }
    return entry;
  };

  for (const inv of openInvoices) {
    const entry = getEntry(inv.customerId);
    const due = new Prisma.Decimal((inv.amountDue as string | number) ?? 0);
    entry.totalOutstanding = entry.totalOutstanding.add(due);

    const dueTime = inv.dueDate ? new Date(inv.dueDate).getTime() : asOfDate.getTime();
    const diffMs = asOfDate.getTime() - dueTime;
    const daysPastDue = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (daysPastDue <= 0) {
      entry.current = entry.current.add(due);
    } else if (daysPastDue >= 1 && daysPastDue <= 30) {
      entry.days1_30 = entry.days1_30.add(due);
    } else if (daysPastDue >= 31 && daysPastDue <= 60) {
      entry.days31_60 = entry.days31_60.add(due);
    } else if (daysPastDue >= 61 && daysPastDue <= 90) {
      entry.days61_90 = entry.days61_90.add(due);
    } else {
      entry.days90Plus = entry.days90Plus.add(due);
    }
  }

  const allCustIds = Array.from(customerMap.keys());
  const rows = allCustIds.map((cId) => {
    const e = customerMap.get(cId)!;
    return {
      groupKey: cId,
      values: {
        current: e.current.toFixed(2),
        days1_30: e.days1_30.toFixed(2),
        days31_60: e.days31_60.toFixed(2),
        days61_90: e.days61_90.toFixed(2),
        days90Plus: e.days90Plus.toFixed(2),
        "invoices.outstandingBalance": e.totalOutstanding.toFixed(2),
      },
    };
  });

  return { rows };
};

registerReportExecutor("financial.arAging", arAgingExecutor);

/**
 * Retrieves the Accounts Receivable (AR) Aging Report via Generic Composition Engine.
 */
export async function getArAgingReport(
  workspaceId: string,
  rawParams?: unknown,
  authContext?: WorkspaceAuthorizationContext,
  reportKeyOrDb?: ReportKey | UnscopedReportDb,
  passedDb?: UnscopedReportDb,
): Promise<ReportResponse> {
  const reportKey: ReportKey =
    typeof reportKeyOrDb === "string" ? reportKeyOrDb : "financial.arAging";
  const db: UnscopedReportDb =
    typeof reportKeyOrDb === "object" && reportKeyOrDb !== null
      ? reportKeyOrDb
      : (passedDb ?? prisma);
  return composeReport(reportKey, workspaceId, rawParams, authContext, db);
}
