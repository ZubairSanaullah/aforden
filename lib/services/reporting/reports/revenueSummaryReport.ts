import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { composeReport } from "../reportEngine";
import { registerReportExecutor } from "../reportRegistry";
import { reportQueryParamsSchema } from "../reporting.schemas";
import {
  ReportCardinalityExceededError,
  ReportParameterValidationError,
} from "../reportingErrors";
import type {
  MetricKey,
  ReportCustomExecutor,
  ReportKey,
  ReportQueryContext,
  ReportResponse,
  UnscopedReportDb,
} from "../reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

export const revenueSummaryReportParamsSchema = reportQueryParamsSchema.extend({
  customerId: z.string().optional(),
  paymentMethod: z.string().optional(),
  currencyCode: z.string().optional(),
});

export type RevenueSummaryReportParams = z.infer<typeof revenueSummaryReportParamsSchema>;

const ZERO_2DP = new Prisma.Decimal("0.00");

interface InvoiceDataRow {
  id: string;
  customerId: string | null;
  currencyCode: string | null;
  total?: Prisma.Decimal | number | string | null;
  amountDue?: Prisma.Decimal | number | string | null;
  issuedAt?: Date | string | null;
  voidedAt?: Date | string | null;
  paidAt?: Date | string | null;
  dueDate?: Date | string | null;
}

interface PaymentDataRow {
  id: string;
  customerId: string | null;
  currencyCode: string | null;
  amount: Prisma.Decimal | number | string | null;
  paymentDate: Date | string;
  paymentMethod?: string | null;
}

/**
 * Custom Query Executor for Revenue Summary Report (Phase 1.14.8 Engine Migration).
 */
export const revenueSummaryExecutor: ReportCustomExecutor = async (
  ctx: ReportQueryContext,
) => {
  const isScalars = ctx.requestedDimensions.length === 0;

  // 1. Invoiced Invoices within period
  const invoicedInvoices = await ctx.scopedDb.invoice.findMany<InvoiceDataRow>({
    where: {
      status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE"] },
      issuedAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc, not: null },
      ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
      ...(ctx.params.currencyCode ? { currencyCode: String(ctx.params.currencyCode) } : {}),
    },
    select: {
      id: true,
      customerId: true,
      currencyCode: true,
      total: true,
      issuedAt: true,
    },
  });

  if (invoicedInvoices.length > 10000) {
    throw new ReportCardinalityExceededError(
      `Invoiced scan count (${invoicedInvoices.length}) exceeds maximum row scan cap.`,
    );
  }

  // 2. Voided Invoices within period
  const voidedInvoices = await ctx.scopedDb.invoice.findMany<InvoiceDataRow>({
    where: {
      status: "VOID",
      voidedAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc, not: null },
      ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
      ...(ctx.params.currencyCode ? { currencyCode: String(ctx.params.currencyCode) } : {}),
    },
    select: {
      id: true,
      customerId: true,
      currencyCode: true,
      total: true,
      voidedAt: true,
    },
  });

  // 3. Payments collected within period
  const payments = await ctx.scopedDb.payment.findMany<PaymentDataRow>({
    where: {
      status: "RECORDED",
      paymentDate: { gte: ctx.range.startUtc, lt: ctx.range.endUtc },
      ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
      ...(ctx.params.paymentMethod ? { paymentMethod: String(ctx.params.paymentMethod) } : {}),
      ...(ctx.params.currencyCode ? { currencyCode: String(ctx.params.currencyCode) } : {}),
    },
    select: {
      id: true,
      customerId: true,
      paymentMethod: true,
      currencyCode: true,
      amount: true,
      paymentDate: true,
    },
  });

  if (payments.length > 10000) {
    throw new ReportCardinalityExceededError(
      `Payments scan count (${payments.length}) exceeds maximum row scan cap.`,
    );
  }

  // 4. Open Invoices for AS_OF Outstanding & Overdue Balances
  const openInvoices = await ctx.scopedDb.invoice.findMany<InvoiceDataRow>({
    where: {
      status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
      amountDue: { not: 0 },
      ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
      ...(ctx.params.currencyCode ? { currencyCode: String(ctx.params.currencyCode) } : {}),
    },
    select: {
      id: true,
      customerId: true,
      currencyCode: true,
      amountDue: true,
      dueDate: true,
    },
  });

  // 5. Paid Invoices for Average Days to Payment
  const paidInvoices = await ctx.scopedDb.invoice.findMany<InvoiceDataRow>({
    where: {
      status: "PAID",
      paidAt: { gte: ctx.range.startUtc, lt: ctx.range.endUtc, not: null },
      issuedAt: { not: null },
      ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
      ...(ctx.params.currencyCode ? { currencyCode: String(ctx.params.currencyCode) } : {}),
    },
    select: {
      id: true,
      customerId: true,
      issuedAt: true,
      paidAt: true,
    },
  });

  // Multi-Currency Verification
  if (!ctx.params.currencyCode) {
    const observedCurrencies = new Set<string>();
    for (const inv of invoicedInvoices) if (inv.currencyCode) observedCurrencies.add(inv.currencyCode);
    for (const p of payments) if (p.currencyCode) observedCurrencies.add(p.currencyCode);
    for (const inv of openInvoices) if (inv.currencyCode) observedCurrencies.add(inv.currencyCode);
    if (observedCurrencies.size > 1) {
      throw new ReportParameterValidationError(
        `Workspace contains multiple currencies (${Array.from(observedCurrencies).join(", ")}). Specify a currencyCode filter to generate financial reports.`,
      );
    }
  }

  // Pure Decimal Aggregations
  let invoicedRevenue = ZERO_2DP;
  for (const inv of invoicedInvoices) {
    invoicedRevenue = invoicedRevenue.add(new Prisma.Decimal((inv.total as string | number) ?? 0));
  }

  let collectedRevenue = ZERO_2DP;
  for (const p of payments) {
    collectedRevenue = collectedRevenue.add(new Prisma.Decimal((p.amount as string | number) ?? 0));
  }

  let voidedTotal = ZERO_2DP;
  for (const inv of voidedInvoices) {
    voidedTotal = voidedTotal.add(new Prisma.Decimal((inv.total as string | number) ?? 0));
  }

  let outstandingBalance = ZERO_2DP;
  let overdueBalance = ZERO_2DP;
  const asOfTime = ctx.range.endUtc ? ctx.range.endUtc.getTime() : Date.now();

  for (const inv of openInvoices) {
    const due = new Prisma.Decimal((inv.amountDue as string | number) ?? 0);
    outstandingBalance = outstandingBalance.add(due);
    if (inv.dueDate && new Date(inv.dueDate).getTime() < asOfTime && due.isPositive()) {
      overdueBalance = overdueBalance.add(due);
    }
  }

  let avgDaysToPayment: number | null = null;
  if (paidInvoices.length > 0) {
    let totalDays = 0;
    for (const inv of paidInvoices) {
      if (inv.paidAt && inv.issuedAt) {
        const diffMs = new Date(inv.paidAt).getTime() - new Date(inv.issuedAt).getTime();
        const days = Math.max(0, diffMs / (1000 * 60 * 60 * 24));
        totalDays += days;
      }
    }
    avgDaysToPayment = Math.round((totalDays / paidInvoices.length) * 100) / 100;
  }

  const values: Record<string, string | number | null> = {
    "invoices.invoicedRevenue": invoicedRevenue.toFixed(2),
    "invoices.issuedCount": invoicedInvoices.length,
    "payments.collectedRevenue": collectedRevenue.toFixed(2),
    "payments.collectedCount": payments.length,
    "invoices.voidedTotal": voidedTotal.toFixed(2),
    "invoices.voidedCount": voidedInvoices.length,
    "invoices.outstandingBalance": outstandingBalance.toFixed(2),
    "invoices.overdueBalance": overdueBalance.toFixed(2),
    "invoices.avgDaysToPayment": avgDaysToPayment,
  };

  if (isScalars) {
    return {
      scalarValues: values,
    };
  }

  // Group by Customer
  const customerMap = new Map<
    string,
    {
      invoicedRevenue: Prisma.Decimal;
      invoicedCount: number;
      collectedRevenue: Prisma.Decimal;
      collectedCount: number;
      voidedTotal: Prisma.Decimal;
      voidedCount: number;
      outstandingBalance: Prisma.Decimal;
      overdueBalance: Prisma.Decimal;
      paidDaysSum: number;
      paidCount: number;
    }
  >();

  const getCustEntry = (cId: string | null | undefined) => {
    const key = cId ?? "UNASSIGNED";
    let entry = customerMap.get(key);
    if (!entry) {
      entry = {
        invoicedRevenue: ZERO_2DP,
        invoicedCount: 0,
        collectedRevenue: ZERO_2DP,
        collectedCount: 0,
        voidedTotal: ZERO_2DP,
        voidedCount: 0,
        outstandingBalance: ZERO_2DP,
        overdueBalance: ZERO_2DP,
        paidDaysSum: 0,
        paidCount: 0,
      };
      customerMap.set(key, entry);
    }
    return entry;
  };

  for (const inv of invoicedInvoices) {
    const e = getCustEntry(inv.customerId);
    e.invoicedRevenue = e.invoicedRevenue.add(new Prisma.Decimal((inv.total as string | number) ?? 0));
    e.invoicedCount += 1;
  }

  for (const p of payments) {
    const e = getCustEntry(p.customerId);
    e.collectedRevenue = e.collectedRevenue.add(new Prisma.Decimal((p.amount as string | number) ?? 0));
    e.collectedCount += 1;
  }

  for (const inv of voidedInvoices) {
    const e = getCustEntry(inv.customerId);
    e.voidedTotal = e.voidedTotal.add(new Prisma.Decimal((inv.total as string | number) ?? 0));
    e.voidedCount += 1;
  }

  for (const inv of openInvoices) {
    const e = getCustEntry(inv.customerId);
    const due = new Prisma.Decimal((inv.amountDue as string | number) ?? 0);
    e.outstandingBalance = e.outstandingBalance.add(due);
    if (inv.dueDate && new Date(inv.dueDate).getTime() < asOfTime && due.isPositive()) {
      e.overdueBalance = e.overdueBalance.add(due);
    }
  }

  for (const inv of paidInvoices) {
    const e = getCustEntry(inv.customerId);
    if (inv.paidAt && inv.issuedAt) {
      e.paidDaysSum += Math.max(
        0,
        (new Date(inv.paidAt).getTime() - new Date(inv.issuedAt).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      e.paidCount += 1;
    }
  }

  const allCustIds = Array.from(customerMap.keys());
  const rows = allCustIds.map((cId) => {
    const e = customerMap.get(cId)!;
    const custAvgDays =
      e.paidCount > 0 ? Math.round((e.paidDaysSum / e.paidCount) * 100) / 100 : null;

    return {
      groupKey: cId,
      values: {
        "invoices.invoicedRevenue": e.invoicedRevenue.toFixed(2),
        "invoices.issuedCount": e.invoicedCount,
        "payments.collectedRevenue": e.collectedRevenue.toFixed(2),
        "payments.collectedCount": e.collectedCount,
        "invoices.voidedTotal": e.voidedTotal.toFixed(2),
        "invoices.voidedCount": e.voidedCount,
        "invoices.outstandingBalance": e.outstandingBalance.toFixed(2),
        "invoices.overdueBalance": e.overdueBalance.toFixed(2),
        "invoices.avgDaysToPayment": custAvgDays,
      },
    };
  });

  return { rows };
};

registerReportExecutor("financial.revenueSummary", revenueSummaryExecutor);

/**
 * Retrieves the Revenue Summary Report via Generic Composition Engine.
 */
export async function getRevenueSummaryReport(
  workspaceId: string,
  rawParams?: unknown,
  actor?: WorkspaceAuthorizationContext,
  reportKeyOrDb?: ReportKey | UnscopedReportDb,
  passedDb?: UnscopedReportDb,
): Promise<ReportResponse> {
  const reportKey: ReportKey =
    typeof reportKeyOrDb === "string" ? reportKeyOrDb : "financial.revenueSummary";
  const db: UnscopedReportDb =
    typeof reportKeyOrDb === "object" && reportKeyOrDb !== null
      ? reportKeyOrDb
      : (passedDb ?? prisma);
  return composeReport(reportKey, workspaceId, rawParams, actor, db);
}
