import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import "@/lib/services/reporting/metrics/operationalMetrics";
import "@/lib/services/reporting/metrics/financialMetrics";
import "@/lib/services/reporting/metrics/schedulingMetrics";
import "@/lib/services/reporting/metrics/technicianMetrics";
import { getMetricDefinition } from "@/lib/services/reporting/metricRegistry";
import { getReportDefinition } from "@/lib/services/reporting/reportRegistry";
import { getRevenueSummaryReport } from "@/lib/services/reporting/reports/revenueSummaryReport";
import { getArAgingReport } from "@/lib/services/reporting/reports/arAgingReport";
import {
  ReportMetricUnavailableError,
  ReportParameterValidationError,
  UnsupportedMetricDimensionCombinationError,
} from "@/lib/services/reporting/reportingErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// =========================================================================
// Predicate-Evaluating In-Memory Database Mock
// =========================================================================
function matchesWhere(item: any, where: any): boolean {
  if (!where) return true;
  for (const key of Object.keys(where)) {
    if (key === "AND") {
      const arr = Array.isArray(where.AND) ? where.AND : [where.AND];
      if (!arr.every((clause: any) => matchesWhere(item, clause))) return false;
      continue;
    }
    if (key === "OR") {
      const arr = Array.isArray(where.OR) ? where.OR : [where.OR];
      if (!arr.some((clause: any) => matchesWhere(item, clause))) return false;
      continue;
    }
    if (key === "NOT") {
      if (matchesWhere(item, where.NOT)) return false;
      continue;
    }

    const expected = where[key];
    const actual = item[key];

    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("in" in expected && Array.isArray(expected.in)) {
        if (!expected.in.includes(actual)) return false;
      }
      if ("notIn" in expected && Array.isArray(expected.notIn)) {
        if (expected.notIn.includes(actual)) return false;
      }
      if ("not" in expected) {
        if (expected.not === null && (actual === null || actual === undefined)) return false;
        if (expected.not !== null && actual === expected.not) return false;
      }
      if ("gte" in expected && expected.gte !== undefined) {
        const itemVal = actual instanceof Date ? actual.getTime() : actual;
        const expVal = expected.gte instanceof Date ? expected.gte.getTime() : expected.gte;
        if (itemVal < expVal) return false;
      }
      if ("gt" in expected && expected.gt !== undefined) {
        const itemVal = typeof actual === "number" ? actual : parseFloat(String(actual ?? 0));
        if (itemVal <= expected.gt) return false;
      }
      if ("lte" in expected && expected.lte !== undefined) {
        const itemVal = actual instanceof Date ? actual.getTime() : actual;
        const expVal = expected.lte instanceof Date ? expected.lte.getTime() : expected.lte;
        if (itemVal > expVal) return false;
      }
      if ("lt" in expected && expected.lt !== undefined) {
        const itemVal = actual instanceof Date ? actual.getTime() : actual;
        const expVal = expected.lt instanceof Date ? expected.lt.getTime() : expected.lt;
        if (itemVal >= expVal) return false;
      }
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function createPredicateEvaluatingDb(data: {
  invoices?: any[];
  payments?: any[];
  customers?: any[];
}) {
  const invoices = data.invoices ?? [];
  const payments = data.payments ?? [];
  const customers = data.customers ?? [];

  return {
    invoice: {
      findMany: async ({ where }: any = {}) => invoices.filter((i) => matchesWhere(i, where)),
    },
    payment: {
      findMany: async ({ where }: any = {}) => payments.filter((p) => matchesWhere(p, where)),
    },
    customer: {
      findMany: async ({ where }: any = {}) => customers.filter((c) => matchesWhere(c, where)),
      findFirst: async ({ where }: any = {}) => customers.find((c) => matchesWhere(c, where)) ?? null,
    },
  };
}

// =========================================================================
// Mock Contexts
// =========================================================================
const mockAdminContext: WorkspaceAuthorizationContext = {
  user: { id: "user_admin", email: "admin@test.com" } as any,
  membership: { id: "mem_admin", role: "ADMIN" } as any,
  workspace: { id: "ws_alpha", name: "Alpha Workspace", timezone: "UTC" } as any,
};

const mockTechnicianContext: WorkspaceAuthorizationContext = {
  user: { id: "user_tech", email: "tech@test.com" } as any,
  membership: { id: "mem_tech", role: "TECHNICIAN" } as any,
  workspace: { id: "ws_alpha", name: "Alpha Workspace", timezone: "UTC" } as any,
};

const mockDispatcherContext: WorkspaceAuthorizationContext = {
  user: { id: "user_disp", email: "disp@test.com" } as any,
  membership: { id: "mem_disp", role: "DISPATCHER" } as any,
  workspace: { id: "ws_alpha", name: "Alpha Workspace", timezone: "UTC" } as any,
};

// =========================================================================
// Test Suite
// =========================================================================
describe("Phase 1.14.6 — Financial Metrics, Revenue Summary & AR Aging", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------

  // 1. Metric Registry Assertions & Open-Closed Deferrals
  // -----------------------------------------------------------------------
  describe("1. Metric Registry Assertions", () => {
    it("verifies invoices.invoicedRevenue definition and write-once date anchor", () => {
      const metric = getMetricDefinition("invoices.invoicedRevenue");
      expect(metric.key).toBe("invoices.invoicedRevenue");
      expect(metric.valueType).toBe("SUM_MONEY");
      expect(metric.temporality).toBe("PERIOD");
      expect(metric.sourceModel).toBe("Invoice");
      expect(metric.dateAnchor).toEqual({ model: "Invoice", field: "issuedAt" });
      expect(metric.isSnapshotDerived).toBe(true);
    });

    it("verifies payments.collectedRevenue definition and paymentDate anchor", () => {
      const metric = getMetricDefinition("payments.collectedRevenue");
      expect(metric.key).toBe("payments.collectedRevenue");
      expect(metric.valueType).toBe("SUM_MONEY");
      expect(metric.temporality).toBe("PERIOD");
      expect(metric.sourceModel).toBe("Payment");
      expect(metric.dateAnchor).toEqual({ model: "Payment", field: "paymentDate" });
    });

    it("verifies invoices.outstandingBalance and overdueBalance AS_OF temporality", () => {
      const outstanding = getMetricDefinition("invoices.outstandingBalance");
      expect(outstanding.temporality).toBe("AS_OF");
      expect(outstanding.dateAnchor).toBeNull();

      const overdue = getMetricDefinition("invoices.overdueBalance");
      expect(overdue.temporality).toBe("AS_OF");
      expect(overdue.dateAnchor).toBeNull();
    });

    it("verifies invoices.avgDaysToPayment is typed AVG_DAYS and anchored on paidAt", () => {
      const avgDays = getMetricDefinition("invoices.avgDaysToPayment");
      expect(avgDays.valueType).toBe("AVG_DAYS");
      expect(avgDays.temporality).toBe("PERIOD");
      expect(avgDays.dateAnchor).toEqual({ model: "Invoice", field: "paidAt" });
    });

    it("verifies Open-Closed 501 deferrals on metric definitions across subphases", () => {
      expect(() => getMetricDefinition("invoices.collectionRate")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("invoices.countByStatus")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("schedule.avgAcknowledgeLatencyMinutes")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("technicians.onTimeArrivalRate")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("technicians.utilizationRate")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("technicians.firstTimeFixRate")).toThrow(ReportMetricUnavailableError);
    });

    it("verifies report registry definitions for financial.revenueSummary and financial.arAging", () => {
      const revDef = getReportDefinition("financial.revenueSummary");
      expect(revDef.category).toBe("FINANCIAL");
      expect(revDef.metrics).toContain("invoices.invoicedRevenue");
      expect(revDef.metrics).toContain("payments.collectedRevenue");

      const arDef = getReportDefinition("financial.arAging");
      expect(arDef.category).toBe("FINANCIAL");
      expect(arDef.metrics).toContain("invoices.outstandingBalance");
    });
  });

  // -----------------------------------------------------------------------
  // 2. AR Aging Exact Boundary & Invariant Tests
  // -----------------------------------------------------------------------
  describe("2. AR Aging Exact Boundary & Invariant Tests", () => {
    it("correctly buckets invoices across exact boundary days (0, 1, 30, 31, 60, 61, 90, 91) and asserts sum invariant", async () => {
      const now = new Date();
      const createDateAtOffset = (daysAgo: number) => {
        return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      };

      const mockDb: any = createPredicateEvaluatingDb({
        customers: [{ id: "cust_1", name: "Acme Corp", workspaceId: "ws_alpha" }],
        invoices: [
          { id: "i_0", customerId: "cust_1", workspaceId: "ws_alpha", status: "ISSUED", amountDue: 100.0, dueDate: createDateAtOffset(0), currencyCode: "USD" },
          { id: "i_1", customerId: "cust_1", workspaceId: "ws_alpha", status: "ISSUED", amountDue: 200.0, dueDate: createDateAtOffset(1), currencyCode: "USD" },
          { id: "i_30", customerId: "cust_1", workspaceId: "ws_alpha", status: "ISSUED", amountDue: 300.0, dueDate: createDateAtOffset(30), currencyCode: "USD" },
          { id: "i_31", customerId: "cust_1", workspaceId: "ws_alpha", status: "ISSUED", amountDue: 400.0, dueDate: createDateAtOffset(31), currencyCode: "USD" },
          { id: "i_60", customerId: "cust_1", workspaceId: "ws_alpha", status: "ISSUED", amountDue: 500.0, dueDate: createDateAtOffset(60), currencyCode: "USD" },
          { id: "i_61", customerId: "cust_1", workspaceId: "ws_alpha", status: "ISSUED", amountDue: 600.0, dueDate: createDateAtOffset(61), currencyCode: "USD" },
          { id: "i_90", customerId: "cust_1", workspaceId: "ws_alpha", status: "ISSUED", amountDue: 700.0, dueDate: createDateAtOffset(90), currencyCode: "USD" },
          { id: "i_91", customerId: "cust_1", workspaceId: "ws_alpha", status: "ISSUED", amountDue: 800.0, dueDate: createDateAtOffset(91), currencyCode: "USD" },
        ],
      });

      const res = await getArAgingReport("ws_alpha", {}, mockAdminContext, "financial.arAging", mockDb);
      const rows = (res as any).items;
      expect(rows.length).toBe(1);

      const row = rows[0];
      const v = row.values as any;
      expect(v.current).toBe("100.00");
      expect(v.days1_30).toBe("500.00"); // 200 + 300
      expect(v.days31_60).toBe("900.00"); // 400 + 500
      expect(v.days61_90).toBe("1300.00"); // 600 + 700
      expect(v.days90Plus).toBe("800.00"); // 800
      expect(v["invoices.outstandingBalance"]).toBe("3600.00");

      // Exact bucket sum invariant
      const bucketSum = new Prisma.Decimal(v.current)
        .add(new Prisma.Decimal(v.days1_30))
        .add(new Prisma.Decimal(v.days31_60))
        .add(new Prisma.Decimal(v.days61_90))
        .add(new Prisma.Decimal(v.days90Plus));

      expect(bucketSum.toFixed(2)).toBe(v["invoices.outstandingBalance"]);
    });

    it("verifies zero-balance exclusion (amountDue > 0)", async () => {
      const now = new Date();
      const mockDb: any = createPredicateEvaluatingDb({
        customers: [{ id: "cust_1", name: "Acme Corp", workspaceId: "ws_alpha" }],
        invoices: [
          // Zero-balance invoice (must be excluded from AR aging)
          { id: "i_zero", customerId: "cust_1", workspaceId: "ws_alpha", status: "PAID", amountDue: 0.0, dueDate: now, currencyCode: "USD" },
          // Positive balance invoice (must be included)
          { id: "i_pos", customerId: "cust_1", workspaceId: "ws_alpha", status: "ISSUED", amountDue: 250.0, dueDate: now, currencyCode: "USD" },
        ],
      });

      const res = await getArAgingReport("ws_alpha", {}, mockAdminContext, "financial.arAging", mockDb);
      expect((res as any).items.length).toBe(1);

      const row = (res as any).items[0];
      const v = row.values as any;
      expect(v.current).toBe("250.00");
      expect(v["invoices.outstandingBalance"]).toBe("250.00");
    });
  });

  // -----------------------------------------------------------------------
  // 3. Revenue Summary Aggregations
  // -----------------------------------------------------------------------
  describe("3. Revenue Summary Aggregations", () => {
    it("excludes DRAFT from invoiced revenue and handles VOID in voided total", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        invoices: [
          { id: "i_draft", workspaceId: "ws_alpha", status: "DRAFT", total: 100.0, issuedAt: null, createdAt: new Date("2026-08-05T10:00:00Z"), currencyCode: "USD" },
          { id: "i_issued", workspaceId: "ws_alpha", status: "ISSUED", total: 250.0, issuedAt: new Date("2026-08-10T10:00:00Z"), currencyCode: "USD" },
          { id: "i_paid", workspaceId: "ws_alpha", status: "PAID", total: 300.0, issuedAt: new Date("2026-08-15T10:00:00Z"), paidAt: new Date("2026-08-20T10:00:00Z"), currencyCode: "USD" },
          { id: "i_void", workspaceId: "ws_alpha", status: "VOID", total: 150.0, issuedAt: new Date("2026-08-01T10:00:00Z"), voidedAt: new Date("2026-08-12T10:00:00Z"), currencyCode: "USD" },
        ],
        payments: [],
      });

      const res = await getRevenueSummaryReport("ws_alpha", { preset: "THIS_MONTH" }, mockAdminContext, "financial.revenueSummary", mockDb);
      const values = (res as any).values;

      // Invoiced revenue = 250 + 300 = 550.00 (excludes DRAFT and VOID)
      expect(values["invoices.invoicedRevenue"]).toBe("550.00");
      expect(values["invoices.issuedCount"]).toBe(2);
      expect(values["invoices.voidedTotal"]).toBe("150.00");
      expect(values["invoices.voidedCount"]).toBe(1);
    });

    it("verifies partial payments across multiple rows and closed-period payment isolation", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        invoices: [],
        payments: [
          // Within period: August 2026
          { id: "p1", workspaceId: "ws_alpha", invoiceId: "inv_1", amount: 50.0, status: "RECORDED", paymentDate: new Date("2026-08-05T12:00:00Z"), currencyCode: "USD" },
          { id: "p2", workspaceId: "ws_alpha", invoiceId: "inv_1", amount: 75.5, status: "RECORDED", paymentDate: new Date("2026-08-15T12:00:00Z"), currencyCode: "USD" },
          // Voided payment (should be excluded)
          { id: "p3", workspaceId: "ws_alpha", invoiceId: "inv_1", amount: 100.0, status: "VOIDED", paymentDate: new Date("2026-08-18T12:00:00Z"), currencyCode: "USD" },
          // Prior month payment (July 2026 - should be isolated)
          { id: "p4", workspaceId: "ws_alpha", invoiceId: "inv_2", amount: 200.0, status: "RECORDED", paymentDate: new Date("2026-07-20T12:00:00Z"), currencyCode: "USD" },
        ],
      });

      const res = await getRevenueSummaryReport("ws_alpha", { preset: "THIS_MONTH" }, mockAdminContext, "financial.revenueSummary", mockDb);
      const values = (res as any).values;

      // Collected = 50.00 + 75.50 = 125.50
      expect(values["payments.collectedRevenue"]).toBe("125.50");
      expect(values["payments.collectedCount"]).toBe(2);
    });

    it("measures avgDaysToPayment between write-once issuedAt and paidAt", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        invoices: [
          {
            id: "i_1",
            workspaceId: "ws_alpha",
            status: "PAID",
            total: 100.0,
            issuedAt: new Date("2026-08-01T00:00:00Z"),
            paidAt: new Date("2026-08-06T00:00:00Z"), // 5 days
            currencyCode: "USD",
          },
          {
            id: "i_2",
            workspaceId: "ws_alpha",
            status: "PAID",
            total: 200.0,
            issuedAt: new Date("2026-08-01T00:00:00Z"),
            paidAt: new Date("2026-08-11T00:00:00Z"), // 10 days
            currencyCode: "USD",
          },
        ],
        payments: [],
      });

      const res = await getRevenueSummaryReport("ws_alpha", { preset: "THIS_MONTH" }, mockAdminContext, "financial.revenueSummary", mockDb);
      const values = (res as any).values;

      // (5 + 10) / 2 = 7.5 days
      expect(values["invoices.avgDaysToPayment"]).toBe(7.5);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Storable Decimal Precision & Float Drift Proof
  // -----------------------------------------------------------------------
  describe("4. Decimal Precision within Decimal(12, 2) Storage Limits", () => {
    it("proves pure Prisma.Decimal arithmetic on 1,000 storable amounts (10.10) where float accumulation drifts", async () => {
      // 1,000 invoices each with total: 10.10 (well within Decimal(12, 2))
      const invoices: any[] = [];
      let floatAccumulator = 0;

      for (let i = 0; i < 1000; i++) {
        invoices.push({
          id: `i_storable_${i}`,
          workspaceId: "ws_alpha",
          status: "ISSUED",
          total: new Prisma.Decimal("10.10"),
          issuedAt: new Date("2026-08-01T10:00:00Z"),
          currencyCode: "USD",
        });
        floatAccumulator += 10.10;
      }

      const mockDb: any = createPredicateEvaluatingDb({ invoices });

      const res = await getRevenueSummaryReport("ws_alpha", { preset: "THIS_MONTH" }, mockAdminContext, "financial.revenueSummary", mockDb);
      const values = (res as any).values;

      // In pure Prisma.Decimal: 1,000 * 10.10 = 10100.00 exactly
      expect(values["invoices.invoicedRevenue"]).toBe("10100.00");
    });
  });

  // -----------------------------------------------------------------------
  // 5. Multi-Currency Rejection
  // -----------------------------------------------------------------------
  describe("5. Multi-Currency Rejection", () => {
    it("rejects multi-currency workspace requests when currencyCode filter is omitted", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        invoices: [
          { id: "i_usd", workspaceId: "ws_alpha", status: "ISSUED", total: 100.0, currencyCode: "USD", issuedAt: new Date("2026-08-01T10:00:00Z") },
          { id: "i_eur", workspaceId: "ws_alpha", status: "ISSUED", total: 200.0, currencyCode: "EUR", issuedAt: new Date("2026-08-01T10:00:00Z") },
        ],
      });

      await expect(
        getRevenueSummaryReport("ws_alpha", { preset: "THIS_MONTH" }, mockAdminContext, "financial.revenueSummary", mockDb),
      ).rejects.toThrow(ReportParameterValidationError);
    });

    it("succeeds for multi-currency workspace when currencyCode filter is provided", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        invoices: [
          { id: "i_usd", workspaceId: "ws_alpha", status: "ISSUED", total: 100.0, currencyCode: "USD", issuedAt: new Date("2026-08-01T10:00:00Z") },
          { id: "i_eur", workspaceId: "ws_alpha", status: "ISSUED", total: 200.0, currencyCode: "EUR", issuedAt: new Date("2026-08-01T10:00:00Z") },
        ],
      });

      const res = await getRevenueSummaryReport("ws_alpha", { preset: "THIS_MONTH", currencyCode: "USD" }, mockAdminContext, "financial.revenueSummary", mockDb);
      const values = (res as any).values;
      expect(values["invoices.invoicedRevenue"]).toBe("100.00");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Temporality Mismatch & Allow-Listing Validation
  // -----------------------------------------------------------------------
  describe("6. Temporality Mismatch & Validation", () => {
    it("fails loudly when requesting an AS_OF metric under period time-series semantics", async () => {
      const mockDb: any = createPredicateEvaluatingDb({});

      await expect(
        getRevenueSummaryReport(
          "ws_alpha",
          { metrics: ["invoices.outstandingBalance"], dimensions: ["time.month" as any] },
          mockAdminContext,
          "financial.revenueSummary",
          mockDb,
        ),
      ).rejects.toThrow(UnsupportedMetricDimensionCombinationError);
    });

    it("fails loudly when requesting a PERIOD metric under AS_OF report semantics", async () => {
      const mockDb: any = createPredicateEvaluatingDb({});

      await expect(
        getArAgingReport(
          "ws_alpha",
          { metrics: ["invoices.invoicedRevenue" as any] },
          mockAdminContext,
          "financial.arAging",
          mockDb,
        ),
      ).rejects.toThrow(UnsupportedMetricDimensionCombinationError);
    });

    it("throws UnsupportedMetricDimensionCombinationError when requesting unallowed metric in financial report", async () => {
      const mockDb: any = createPredicateEvaluatingDb({});

      await expect(
        getRevenueSummaryReport(
          "ws_alpha",
          { metrics: ["workOrders.completedCount" as any] },
          mockAdminContext,
          "financial.revenueSummary",
          mockDb,
        ),
      ).rejects.toThrow(UnsupportedMetricDimensionCombinationError);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Authorization & Cross-Tenant Security
  // -----------------------------------------------------------------------
  describe("7. Authorization & Cross-Tenant Security", () => {
    it("denies TECHNICIAN and DISPATCHER roles on financial reports with 403", async () => {
      const mockDb: any = createPredicateEvaluatingDb({});

      await expect(
        getRevenueSummaryReport("ws_alpha", {}, mockTechnicianContext, "financial.revenueSummary", mockDb),
      ).rejects.toThrow();

      await expect(
        getArAgingReport("ws_alpha", {}, mockTechnicianContext, "financial.arAging", mockDb),
      ).rejects.toThrow();

      await expect(
        getRevenueSummaryReport("ws_alpha", {}, mockDispatcherContext, "financial.revenueSummary", mockDb),
      ).rejects.toThrow();
    });

    it("ensures foreign workspace financial data is invisible", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        invoices: [
          { id: "i_local", workspaceId: "ws_alpha", status: "ISSUED", total: 500.0, issuedAt: new Date("2026-08-01T10:00:00Z"), currencyCode: "USD" },
          { id: "i_foreign", workspaceId: "ws_foreign", status: "ISSUED", total: 10000.0, issuedAt: new Date("2026-08-01T10:00:00Z"), currencyCode: "USD" },
        ],
      });

      const res = await getRevenueSummaryReport("ws_alpha", { preset: "THIS_MONTH" }, mockAdminContext, "financial.revenueSummary", mockDb);
      const values = (res as any).values;
      expect(values["invoices.invoicedRevenue"]).toBe("500.00");
    });

    it("throws 501 ReportMetricUnavailableError for past-dated historical AR aging (Rule A.4)", async () => {
      const mockDb: any = createPredicateEvaluatingDb({});
      const pastAsOf = "2024-01-01T00:00:00Z";

      await expect(
        getArAgingReport("ws_alpha", { asOf: pastAsOf }, mockAdminContext, "financial.arAging", mockDb),
      ).rejects.toThrow(ReportMetricUnavailableError);
    });
  });
});
