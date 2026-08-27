import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { composeReport, createScopedDb } from "@/lib/services/reporting/reportEngine";
import {
  registerReport,
  unregisterReport,
  getReportDefinition,
} from "@/lib/services/reporting/reportRegistry";
import {
  registerMetric,
  unregisterMetric,
  getMetricDefinition,
} from "@/lib/services/reporting/metricRegistry";
import {
  registerDimension,
  unregisterDimension,
} from "@/lib/services/reporting/dimensionRegistry";
import {
  registerFilter,
  unregisterFilter,
} from "@/lib/services/reporting/filterRegistry";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import {
  ReportScopeViolationError,
  ReportCardinalityExceededError,
  UnsupportedMetricDimensionCombinationError,
  ReportMetricUnavailableError,
  ReportParameterValidationError,
} from "@/lib/services/reporting/reportingErrors";
import type {
  ReportDefinition,
  MetricDefinition,
  DimensionDefinition,
  FilterDefinition,
} from "@/lib/services/reporting/reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Import all metric and report registrations
import "@/lib/services/reporting/metrics/operationalMetrics";
import "@/lib/services/reporting/metrics/schedulingMetrics";
import "@/lib/services/reporting/metrics/technicianMetrics";
import "@/lib/services/reporting/metrics/financialMetrics";
import "@/lib/services/reporting/metrics/inventoryMetrics";
import "@/lib/services/reporting/metrics/assetMetrics";
import "@/lib/services/reporting/metrics/customerMetrics";
import { getWorkOrderVolumeReport } from "@/lib/services/reporting/reports/workOrderVolumeReport";
import { getWorkOrderThroughputReport } from "@/lib/services/reporting/reports/workOrderThroughputReport";
import { getDispatchPerformanceReport } from "@/lib/services/reporting/reports/dispatchPerformanceReport";
import { getTechnicianProductivityReport } from "@/lib/services/reporting/reports/technicianProductivityReport";
import { getRevenueSummaryReport } from "@/lib/services/reporting/reports/revenueSummaryReport";
import { getArAgingReport } from "@/lib/services/reporting/reports/arAgingReport";
import { getPartsConsumptionReport } from "@/lib/services/reporting/reports/partsConsumptionReport";
import { getAssetSummaryReport } from "@/lib/services/reporting/reports/assetSummaryReport";
import { getCustomerSummaryReport } from "@/lib/services/reporting/reports/customerSummaryReport";
import { getQuoteConversionReport } from "@/lib/services/reporting/reports/quoteConversionReport";

describe("Phase 1.14.8 — Generic Report Composition Engine", () => {
  const workspaceId = "ws-engine-test";

  const adminAuth: WorkspaceAuthorizationContext = {
    user: { id: "user-admin", email: "admin@test.com" } as any,
    membership: {
      id: "mem-admin",
      role: "ADMIN",
      userId: "user-admin",
    } as any,
    workspace: {
      id: workspaceId,
      name: "Engine Workspace",
      slug: "engine-ws",
      timezone: "America/New_York",
      logoUrl: null,
    } as any,
  };

  const techAuth: WorkspaceAuthorizationContext = {
    user: { id: "user-tech", email: "tech@test.com" } as any,
    membership: {
      id: "mem-tech",
      role: "TECHNICIAN",
      userId: "user-tech",
    } as any,
    workspace: {
      id: workspaceId,
      name: "Engine Workspace",
      slug: "engine-ws",
      timezone: "America/New_York",
      logoUrl: null,
    } as any,
  };

  describe("1. Canonical Pipeline Stages", () => {
    it("Stage 1: Enforces RBAC permission check on caller", async () => {
      // technician calling an operational report requires REPORTS_VIEW_OPERATIONAL
      await expect(
        composeReport("operational.workOrderVolume", workspaceId, {}, techAuth),
      ).rejects.toThrow();
    });

    it("Stage 2: Validates report query params against paramsSchema", async () => {
      await expect(
        composeReport(
          "operational.workOrderVolume",
          workspaceId,
          { preset: "INVALID_PRESET" },
          adminAuth,
        ),
      ).rejects.toThrow();
    });

    it("Stage 3: Resolves date range strictly via canonical dateRange authority", async () => {
      const mockDb: any = {
        workOrder: {
          count: async () => 10,
        },
      };

      const res = await composeReport(
        "operational.workOrderVolume",
        workspaceId,
        { preset: "THIS_MONTH" },
        adminAuth,
        mockDb,
      );

      expect(res.meta.range).toBeDefined();
      expect(res.meta.timezone).toBe("America/New_York");
      expect(res.meta.range?.preset).toBe("THIS_MONTH");
      expect(res.meta.shape).toBe("SCALARS");
    });

    it("Stage 4 & 5: Validates metrics and dimensions against closed registries", async () => {
      await expect(
        composeReport(
          "operational.workOrderVolume",
          workspaceId,
          { metrics: ["unregistered.fakeMetric"] },
          adminAuth,
        ),
      ).rejects.toThrow();

      await expect(
        composeReport(
          "operational.workOrderVolume",
          workspaceId,
          { dimensions: ["unregistered.fakeDimension"] },
          adminAuth,
        ),
      ).rejects.toThrow();
    });

    it("Stage 8: Hydrates dimension labels in batched queries for grouped reports", async () => {
      const mockDb: any = {
        customer: {
          findMany: async ({ where }: any) => [
            { id: "cust-1", name: "Acme Corp" },
            { id: "cust-2", name: "Beta LLC" },
          ],
        },
        workOrder: {
          groupBy: async () => [
            { customerId: "cust-1", _count: { _all: 5 } },
            { customerId: "cust-2", _count: { _all: 12 } },
          ],
        },
      };

      const res: any = await composeReport(
        "operational.workOrderVolume",
        workspaceId,
        { dimensions: ["customer"] },
        adminAuth,
        mockDb,
      );

      expect(res.meta.shape).toBe("ROWS");
      expect(res.items).toHaveLength(2);
      expect(res.items[0].dimensions.customer.label).toBe("Beta LLC"); // sorted desc by count
      expect(res.items[1].dimensions.customer.label).toBe("Acme Corp");
    });

    it("Stage 9: Deterministic sorting, tie-breaking, and MAX_GROUP_CARDINALITY truncation", async () => {
      const mockDb: any = {
        customer: {
          findMany: async () => [],
        },
        workOrder: {
          groupBy: async () => {
            const rows = [];
            for (let i = 1; i <= 1005; i++) {
              rows.push({
                customerId: `cust-${String(i).padStart(4, "0")}`,
                _count: { _all: 1 },
              });
            }
            return rows;
          },
        },
      };

      const res: any = await composeReport(
        "operational.workOrderVolume",
        workspaceId,
        { dimensions: ["customer"] },
        adminAuth,
        mockDb,
      );

      expect(res.meta.truncated).toBe(true);
      expect(res.meta.totalUncappedCount).toBe(1005);
      expect(res.items).toHaveLength(1000);
      // Secondary tie-breaker: groupKey ascending
      expect(res.items[0].dimensions.customer.key).toBe("cust-0001");
      expect(res.items[1].dimensions.customer.key).toBe("cust-0002");
    });
  });

  describe("2. Escape Hatch Boundaries & Scoping Invariants", () => {
    it("guarantees scopedDb intercepts queries and forces workspace isolation", async () => {
      let interceptedWhere: any = null;

      const mockDb: any = {
        workOrder: {
          findMany: vi.fn(async (args: any) => {
            interceptedWhere = args.where;
            return [];
          }),
        },
      };

      const scoped = createScopedDb(workspaceId, mockDb);

      // Caller attempts to supply foreign workspaceId or no workspaceId
      await scoped.workOrder.findMany({
        where: { workspaceId: "foreign-tenant-evil-read", status: "COMPLETED" },
      });

      // scopedDb forced the bound workspaceId
      expect(interceptedWhere.workspaceId).toBe(workspaceId);
      expect(interceptedWhere.status).toBe("COMPLETED");
    });

    it("verifies closed registry registration rejects keys absent from constant arrays", () => {
      expect(() => {
        registerReport({
          reportKey: "unauthorized.rogueReport" as any,
          category: "OPERATIONAL",
          title: "Rogue",
          metrics: [],
          allowedDimensions: [],
          allowedFilters: [],
          allowedSortKeys: [],
          defaultSort: { key: "foo" as any, order: "asc" },
          requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
          selfScopedRoles: [],
          supportsTimeSeries: false,
          supportsCsvExport: false,
          paramsSchema: z.object({}),
          description: "Rogue",
        });
      }).toThrow(ReportParameterValidationError);

      expect(() => {
        registerMetric({
          key: "unauthorized.rogueMetric" as any,
          category: "OPERATIONAL",
          valueType: "COUNT",
          temporality: "PERIOD",
          sourceModel: "WorkOrder",
          dateAnchor: { model: "WorkOrder", field: "createdAt" },
          baseWhere: () => ({}),
          aggregation: { kind: "COUNT" },
          requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
          supportedDimensions: [],
          isSnapshotDerived: false,
          materializationTrigger: null,
          description: "Rogue",
        });
      }).toThrow(ReportParameterValidationError);
    });

    it("verifies deferred 501 metrics remain unreachable via composition engine", async () => {
      await expect(
        composeReport(
          "operational.workOrderVolume",
          workspaceId,
          { metrics: ["inventory.stockValue"] },
          adminAuth,
        ),
      ).rejects.toThrow(ReportMetricUnavailableError);
    });
  });

  describe("3. Divide-by-Zero Strict null Invariant Across Value Types", () => {
    it("guarantees rate metric (workOrders.completionRate) returns null when denominator is 0", async () => {
      const mockDb: any = {
        workOrder: {
          count: async () => 0, // createdCount = 0, completedCount = 0
        },
      };

      const res: any = await getWorkOrderVolumeReport(
        workspaceId,
        { preset: "THIS_MONTH" },
        adminAuth,
        mockDb,
      );

      expect(res.values["workOrders.createdCount"]).toBe(0);
      expect(res.values["workOrders.completionRate"]).toBeNull();
    });

    it("guarantees average metric (workOrders.avgCycleTimeMinutes) returns null when count is 0", async () => {
      const mockDb: any = {
        workOrder: {
          count: async () => 0,
          findMany: async () => [],
        },
      };

      const res: any = await getWorkOrderThroughputReport(
        workspaceId,
        { preset: "THIS_MONTH" },
        adminAuth,
        mockDb,
      );

      expect(res.values["workOrders.completedCount"]).toBe(0);
      expect(res.values["workOrders.avgCycleTimeMinutes"]).toBeNull();
    });

    it("guarantees ratio metric (technicians.onSiteShareOfTrackedTime) returns null when tracked time is 0", async () => {
      const mockDb: any = {
        employee: {
          findFirst: async () => ({ id: "emp-1", technicianProfile: { id: "tech-1" } }),
        },
        technicianProfile: {
          findMany: async () => [{ id: "tech-1" }],
        },
        workOrder: {
          findMany: async () => [],
          groupBy: async () => [],
        },
        technicianTimeEntry: {
          findMany: async () => [],
        },
        workOrderHistory: {
          findMany: async () => [],
        },
      };

      const res: any = await getTechnicianProductivityReport(
        workspaceId,
        { preset: "THIS_MONTH" },
        techAuth,
        "technician.selfScorecard",
        mockDb,
      );

      expect(res.meta.shape).toBe("SCALARS");
      expect(res.values["technicians.trackedMinutes"]).toBe(0);
      expect(res.values["technicians.onSiteShareOfTrackedTime"]).toBeNull();
    });

    it("guarantees repeat rate metric (customers.repeatCustomerRate) returns null when serviced customers is 0", async () => {
      const mockDb: any = {
        customer: {
          findMany: async () => [{ id: "c-1", name: "C1", status: "ACTIVE", createdAt: new Date() }],
        },
        workOrder: {
          findMany: async () => [],
        },
        invoice: {
          findMany: async () => [],
        },
      };

      const res: any = await getCustomerSummaryReport(
        workspaceId,
        { preset: "THIS_MONTH" },
        adminAuth,
        mockDb,
      );

      expect(res.values["customers.repeatCustomerRate"]).toBeNull();
    });
  });

  describe("4. Real Part E Open-Closed Extension (Quote Conversion & Pipeline)", () => {
    it("executes financial.quoteConversion report with zero changes to reportEngine.ts", async () => {
      const mockDb: any = {
        quote: {
          findMany: async () => [
            { id: "q-1", customerId: "c-1", status: "APPROVED", total: "1500.00", createdAt: new Date() },
            { id: "q-2", customerId: "c-1", status: "REJECTED", total: "500.00", createdAt: new Date() },
            { id: "q-3", customerId: "c-2", status: "PENDING", total: "2200.00", createdAt: new Date() },
          ],
        },
      };

      const res: any = await getQuoteConversionReport(
        workspaceId,
        { preset: "THIS_MONTH" },
        adminAuth,
        mockDb,
      );

      expect(res.meta.reportKey).toBe("financial.quoteConversion");
      expect(res.meta.shape).toBe("SCALARS");
      expect(res.values["quotes.createdCount"]).toBe(3);
      expect(res.values["quotes.approvedCount"]).toBe(1);
      expect(res.values["quotes.rejectedCount"]).toBe(1);
      expect(res.values["quotes.approvedTotal"]).toBe("1500.00");
      expect(res.values["quotes.pipelineTotal"]).toBe("2200.00");
      expect(res.values["quotes.winRate"]).toBe(33.33); // 1 / 3 = 33.33%
    });

    it("executes financial.quoteConversion grouped by customer with hydrated labels", async () => {
      const mockDb: any = {
        customer: {
          findMany: async () => [
            { id: "c-1", name: "Alpha Corp" },
            { id: "c-2", name: "Beta LLC" },
          ],
        },
        quote: {
          findMany: async () => [
            { id: "q-1", customerId: "c-1", status: "APPROVED", total: "1500.00", createdAt: new Date() },
            { id: "q-2", customerId: "c-2", status: "PENDING", total: "2200.00", createdAt: new Date() },
          ],
        },
      };

      const res: any = await getQuoteConversionReport(
        workspaceId,
        { dimensions: ["customer"], preset: "THIS_MONTH" },
        adminAuth,
        mockDb,
      );

      expect(res.meta.shape).toBe("ROWS");
      expect(res.items).toHaveLength(2);
      expect(res.items[0].dimensions.customer.label).toBe("Beta LLC"); // 2200 pipeline desc
      expect(res.items[0].values["quotes.pipelineTotal"]).toBe("2200.00");
      expect(res.items[1].dimensions.customer.label).toBe("Alpha Corp");
      expect(res.items[1].values["quotes.approvedTotal"]).toBe("1500.00");
    });
  });

  describe("5. Measured Database Query Round-Trip Counts (Part F Instrumentation)", () => {
    function createCountingDb(data: any = {}) {
      let callCount = 0;
      const count = () => {
        callCount++;
      };

      const createCountingModel = (modelData: any = {}) => ({
        findMany: async (args: any) => {
          count();
          return modelData.findMany ? modelData.findMany(args) : [];
        },
        findFirst: async (args: any) => {
          count();
          return modelData.findFirst ? modelData.findFirst(args) : null;
        },
        count: async (args: any) => {
          count();
          return modelData.count ? modelData.count(args) : 0;
        },
        groupBy: async (args: any) => {
          count();
          return modelData.groupBy ? modelData.groupBy(args) : [];
        },
      });

      return {
        getCallCount: () => callCount,
        resetCallCount: () => {
          callCount = 0;
        },
        workOrder: createCountingModel(data.workOrder),
        scheduleAppointment: createCountingModel(data.scheduleAppointment),
        scheduleAppointmentHistory: createCountingModel(data.scheduleAppointmentHistory),
        technicianProfile: createCountingModel(data.technicianProfile),
        technicianTimeEntry: createCountingModel(data.technicianTimeEntry),
        workOrderHistory: createCountingModel(data.workOrderHistory),
        invoice: createCountingModel(data.invoice),
        payment: createCountingModel(data.payment),
        workOrderPart: createCountingModel(data.workOrderPart),
        part: createCountingModel(data.part),
        inventoryLocation: createCountingModel(data.inventoryLocation),
        inventoryBalance: createCountingModel(data.inventoryBalance),
        stockMovement: createCountingModel(data.stockMovement),
        asset: createCountingModel(data.asset),
        assetCategory: createCountingModel(data.assetCategory),
        customer: createCountingModel(data.customer),
        workType: createCountingModel(data.workType),
        serviceCatalog: createCountingModel(data.serviceCatalog),
        quote: createCountingModel(data.quote),
        employee: createCountingModel(data.employee),
      };
    }

    it("measures operational.workOrderVolume round-trips: SCALARS = 3, ROWS = 4", async () => {
      const db = createCountingDb({
        workOrder: {
          groupBy: async () => [{ customerId: "c-1", _count: { _all: 1 } }],
        },
      });
      await getWorkOrderVolumeReport(workspaceId, { preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(3); // count created, count completed, count cancelled

      db.resetCallCount();
      await getWorkOrderVolumeReport(workspaceId, { dimensions: ["customer"], preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(4); // 3 groupBy + 1 hydrateLabels
    });

    it("measures operational.workOrderThroughput round-trips: SCALARS = 1, ROWS = 3", async () => {
      const db = createCountingDb({
        workOrder: {
          groupBy: async () => [{ customerId: "c-1", _count: { _all: 1 } }],
        },
      });
      await getWorkOrderThroughputReport(workspaceId, { preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(1); // count completed

      db.resetCallCount();
      await getWorkOrderThroughputReport(workspaceId, { dimensions: ["customer"], preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(3); // 1 groupBy + 1 findMany rows + 1 hydrateLabels
    });

    it("measures scheduling.dispatchPerformance round-trips: SCALARS = 4, ROWS = 6", async () => {
      const db = createCountingDb({
        scheduleAppointment: {
          groupBy: async () => [{ technicianId: "t-1", _count: { _all: 1 } }],
          findMany: async () => [{ technicianId: "t-1", createdAt: new Date(), dispatchedAt: new Date() }],
        },
      });
      await getDispatchPerformanceReport(workspaceId, { preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(4); // count scheduled, count completed, count cancelled, count dispatched

      db.resetCallCount();
      await getDispatchPerformanceReport(workspaceId, { dimensions: ["technician"], preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(6); // 4 groupBy + 1 findMany latency rows + 1 hydrateLabels
    });

    it("measures technician.productivity round-trips: SCALARS = 4, ROWS = 6", async () => {
      const db = createCountingDb({
        technicianProfile: {
          findMany: async () => [{ id: "tech-1" }],
        },
      });
      await getTechnicianProductivityReport(workspaceId, { preset: "THIS_MONTH" }, adminAuth, "technician.selfScorecard", db as any);
      expect(db.getCallCount()).toBe(4); // 4 data queries (no scope query needed for Admin read-all)

      db.resetCallCount();
      await getTechnicianProductivityReport(workspaceId, { dimensions: ["technician"], preset: "THIS_MONTH" }, adminAuth, "technician.productivity", db as any);
      expect(db.getCallCount()).toBe(6); // 4 queries + 1 qualifying profiles + 1 hydrateLabels
    });

    it("measures technician.selfScorecard round-trips: SCALARS = 6", async () => {
      const db = createCountingDb({
        employee: {
          findFirst: async () => ({ id: "emp-1", technicianProfile: { id: "tech-1" } }),
        },
      });
      await getTechnicianProductivityReport(workspaceId, { preset: "THIS_MONTH" }, techAuth, "technician.selfScorecard", db as any);
      expect(db.getCallCount()).toBe(6); // 1 employee scope + 4 data queries + 1 history query
    });

    it("measures financial.revenueSummary round-trips: SCALARS = 5, ROWS = 6", async () => {
      const db = createCountingDb({
        invoice: {
          findMany: async () => [{ id: "i-1", customerId: "c-1", total: 100, currencyCode: "USD" }],
        },
      });
      await getRevenueSummaryReport(workspaceId, { preset: "THIS_MONTH", currencyCode: "USD" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(5); // 5 findMany queries (invoiced, voided, payments, open, paid)

      db.resetCallCount();
      await getRevenueSummaryReport(workspaceId, { dimensions: ["customer"], preset: "THIS_MONTH", currencyCode: "USD" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(6); // 5 queries + 1 hydrateLabels
    });

    it("measures financial.arAging round-trips: ROWS = 2", async () => {
      const db = createCountingDb({
        invoice: {
          findMany: async () => [{ id: "i-1", customerId: "c-1", amountDue: 100, currencyCode: "USD", dueDate: new Date() }],
        },
      });
      await getArAgingReport(workspaceId, { dimensions: ["customer"], currencyCode: "USD" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(2); // 1 findMany open invoices + 1 hydrateLabels
    });

    it("measures inventory.partsConsumption round-trips: SCALARS = 4, ROWS = 4", async () => {
      const db = createCountingDb({
        workOrderPart: {
          groupBy: async () => [{ partId: "p-1", _sum: { quantity: 10 } }],
        },
      });
      await getPartsConsumptionReport(workspaceId, { preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(4); // 1 consumed groupBy + 1 balance findMany + 1 parts findMany + 1 movements findMany

      db.resetCallCount();
      await getPartsConsumptionReport(workspaceId, { dimensions: ["part"], preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(4); // 3 queries + 1 hydrateLabels
    });

    it("measures asset.summary round-trips: SCALARS = 2, ROWS = 3", async () => {
      const db = createCountingDb({
        asset: {
          findMany: async () => [{ id: "a-1", categoryId: "cat-1" }],
        },
        workOrder: {
          findMany: async () => [{ assetId: "a-1" }],
        },
      });
      await getAssetSummaryReport(workspaceId, { preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(2); // 1 asset findMany + 1 workOrder findMany

      db.resetCallCount();
      await getAssetSummaryReport(workspaceId, { dimensions: ["assetCategory"], preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(3); // 2 findMany + 1 hydrateLabels
    });

    it("measures customer.activitySummary round-trips: SCALARS = 4, ROWS = 5", async () => {
      const db = createCountingDb({
        customer: {
          findMany: async () => [{ id: "c-1", name: "C1", status: "ACTIVE", createdAt: new Date() }],
        },
      });
      await getCustomerSummaryReport(workspaceId, { preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(4); // 2 customer findMany + 1 workOrder findMany + 1 invoice findMany

      db.resetCallCount();
      await getCustomerSummaryReport(workspaceId, { dimensions: ["customer"], preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(5); // 4 queries + 1 hydrateLabels
    });

    it("measures financial.quoteConversion round-trips: SCALARS = 1, ROWS = 2", async () => {
      const db = createCountingDb({
        quote: {
          findMany: async () => [{ id: "q-1", customerId: "c-1", status: "APPROVED", total: "100" }],
        },
      });
      await getQuoteConversionReport(workspaceId, { preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(1); // 1 quote findMany

      db.resetCallCount();
      await getQuoteConversionReport(workspaceId, { dimensions: ["customer"], preset: "THIS_MONTH" }, adminAuth, db as any);
      expect(db.getCallCount()).toBe(2); // 1 quote findMany + 1 hydrateLabels
    });
  });
});
