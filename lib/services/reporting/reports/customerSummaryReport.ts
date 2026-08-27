import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { composeReport } from "../reportEngine";
import { registerReportExecutor } from "../reportRegistry";
import { ReportParameterValidationError } from "../reportingErrors";
import type {
  ReportCustomExecutor,
  ReportKey,
  ReportQueryContext,
  ReportResponse,
  UnscopedReportDb,
} from "../reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

const ZERO_2DP = new Prisma.Decimal("0.00");

interface CustomerRow {
  id: string;
  name?: string | null;
  customerNumber?: string | null;
  status: string;
  createdAt: Date | string;
}

interface CustomerWorkOrderRow {
  id: string;
  customerId: string | null;
  status?: string;
  completedAt?: Date | string | null;
}

interface CustomerInvoiceRow {
  id: string;
  customerId: string | null;
  total?: Prisma.Decimal | number | string | null;
  currencyCode: string | null;
}

/**
 * Custom Query Executor for Customer Summary Report (Phase 1.14.8 Engine Migration).
 */
export const customerSummaryExecutor: ReportCustomExecutor = async (
  ctx: ReportQueryContext,
) => {
  const isScalars = ctx.requestedDimensions.length === 0;

  // 1. Customers
  const customers = await ctx.scopedDb.customer.findMany<CustomerRow>({
    where: {
      ...(ctx.params.customerId ? { id: String(ctx.params.customerId) } : {}),
    },
    select: {
      id: true,
      name: true,
      customerNumber: true,
      status: true,
      createdAt: true,
    },
  });

  let activeCount = 0;
  let newCount = 0;

  const startMs = ctx.range.startUtc.getTime();
  const endMs = ctx.range.endUtc.getTime();

  for (const c of customers) {
    if (c.status === "ACTIVE") activeCount++;
    const createdMs = new Date(c.createdAt).getTime();
    if (createdMs >= startMs && createdMs < endMs) {
      newCount++;
    }
  }

  // 2. Work Orders in Period
  const periodWorkOrders = await ctx.scopedDb.workOrder.findMany<CustomerWorkOrderRow>({
    where: {
      createdAt: {
        gte: ctx.range.startUtc,
        lt: ctx.range.endUtc,
      },
      ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
    },
    select: {
      id: true,
      customerId: true,
      status: true,
      completedAt: true,
    },
  });

  const distinctCustomersWithWOs = new Set<string>();
  for (const wo of periodWorkOrders) {
    if (wo.customerId) distinctCustomersWithWOs.add(wo.customerId);
  }

  const workOrdersPerCustomer =
    distinctCustomersWithWOs.size > 0
      ? Math.round((periodWorkOrders.length / distinctCustomersWithWOs.size) * 100) / 100
      : null;

  // 3. Repeat Customer Rate (serviced customers with >= 2 completed work orders in period)
  const completedWorkOrders = await ctx.scopedDb.workOrder.findMany<CustomerWorkOrderRow>({
    where: {
      status: "COMPLETED",
      completedAt: {
        gte: ctx.range.startUtc,
        lt: ctx.range.endUtc,
      },
      ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
    },
    select: {
      id: true,
      customerId: true,
    },
  });

  const customerCompletionCounts = new Map<string, number>();
  for (const cwo of completedWorkOrders) {
    if (cwo.customerId) {
      customerCompletionCounts.set(
        cwo.customerId,
        (customerCompletionCounts.get(cwo.customerId) ?? 0) + 1,
      );
    }
  }

  let repeatCustomerCount = 0;
  const totalServicedCustomers = customerCompletionCounts.size;

  for (const count of customerCompletionCounts.values()) {
    if (count >= 2) {
      repeatCustomerCount++;
    }
  }

  const repeatCustomerRate =
    totalServicedCustomers > 0
      ? Math.round((repeatCustomerCount / totalServicedCustomers) * 10000) / 100
      : null;

  // 4. Lifetime Invoiced Value (pure Decimal snapshot arithmetic)
  const invoices = await ctx.scopedDb.invoice.findMany<CustomerInvoiceRow>({
    where: {
      status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE"] },
      ...(ctx.params.customerId ? { customerId: String(ctx.params.customerId) } : {}),
      ...(ctx.params.currencyCode ? { currencyCode: String(ctx.params.currencyCode) } : {}),
    },
    select: {
      id: true,
      customerId: true,
      total: true,
      currencyCode: true,
    },
  });

  // Multi-currency check if currencyCode not specified
  if (!ctx.params.currencyCode) {
    const observedCurrencies = new Set<string>();
    for (const inv of invoices) if (inv.currencyCode) observedCurrencies.add(inv.currencyCode);
    if (observedCurrencies.size > 1) {
      throw new ReportParameterValidationError(
        `Workspace contains multiple currencies (${Array.from(observedCurrencies).join(", ")}). Specify a currencyCode filter to generate customer revenue reports.`,
      );
    }
  }

  let totalLifetimeRevenue = ZERO_2DP;
  const customerRevenueMap = new Map<string, Prisma.Decimal>();

  for (const inv of invoices) {
    const tot = new Prisma.Decimal((inv.total as string | number) ?? 0);
    totalLifetimeRevenue = totalLifetimeRevenue.add(tot);

    const cId = inv.customerId ?? "UNASSIGNED";
    const cur = customerRevenueMap.get(cId) ?? ZERO_2DP;
    customerRevenueMap.set(cId, cur.add(tot));
  }

  if (isScalars) {
    return {
      scalarValues: {
        "customers.activeCount": activeCount,
        "customers.newCount": newCount,
        "customers.workOrdersPerCustomer": workOrdersPerCustomer,
        "customers.lifetimeInvoicedRevenue": totalLifetimeRevenue.toFixed(2),
        "customers.repeatCustomerRate": repeatCustomerRate,
      },
    };
  }

  // Grouped rows (e.g. dimension = "customer")
  const groupMap = new Map<
    string,
    {
      workOrdersCount: number;
      completedWOsCount: number;
      lifetimeRevenue: Prisma.Decimal;
    }
  >();

  for (const c of customers) {
    groupMap.set(c.id, {
      workOrdersCount: 0,
      completedWOsCount: 0,
      lifetimeRevenue: customerRevenueMap.get(c.id) ?? ZERO_2DP,
    });
  }

  for (const wo of periodWorkOrders) {
    if (wo.customerId) {
      let entry = groupMap.get(wo.customerId);
      if (!entry) {
        entry = { workOrdersCount: 0, completedWOsCount: 0, lifetimeRevenue: ZERO_2DP };
        groupMap.set(wo.customerId, entry);
      }
      entry.workOrdersCount++;
    }
  }

  for (const cwo of completedWorkOrders) {
    if (cwo.customerId) {
      let entry = groupMap.get(cwo.customerId);
      if (entry) entry.completedWOsCount++;
    }
  }

  const rows = Array.from(groupMap.keys()).map((id) => {
    const e = groupMap.get(id)!;
    return {
      groupKey: id,
      values: {
        "customers.workOrdersPerCustomer": e.workOrdersCount,
        "customers.lifetimeInvoicedRevenue": e.lifetimeRevenue.toFixed(2),
        "customers.repeatCustomerRate": e.completedWOsCount >= 2 ? 100.0 : 0.0,
      },
    };
  });

  return { rows };
};

registerReportExecutor("customer.activitySummary", customerSummaryExecutor);

/**
 * Retrieves the Customer Activity Summary Report via Generic Composition Engine.
 */
export async function getCustomerSummaryReport(
  workspaceId: string,
  rawParams?: unknown,
  authContext?: WorkspaceAuthorizationContext,
  reportKeyOrDb?: ReportKey | UnscopedReportDb,
  passedDb?: UnscopedReportDb,
): Promise<ReportResponse> {
  const reportKey: ReportKey =
    typeof reportKeyOrDb === "string" ? reportKeyOrDb : "customer.activitySummary";
  const db: UnscopedReportDb =
    typeof reportKeyOrDb === "object" && reportKeyOrDb !== null
      ? reportKeyOrDb
      : (passedDb ?? prisma);
  return composeReport(reportKey, workspaceId, rawParams, authContext, db);
}
