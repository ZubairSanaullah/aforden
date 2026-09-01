import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import "@/lib/services/reporting/metrics/operationalMetrics";
import "@/lib/services/reporting/metrics/schedulingMetrics";
import "@/lib/services/reporting/metrics/technicianMetrics";
import "@/lib/services/reporting/metrics/financialMetrics";
import "@/lib/services/reporting/metrics/inventoryMetrics";
import "@/lib/services/reporting/metrics/assetMetrics";
import "@/lib/services/reporting/metrics/customerMetrics";
import { getMetricDefinition, METRIC_REGISTRY } from "@/lib/services/reporting/metricRegistry";
import { getReportDefinition } from "@/lib/services/reporting/reportRegistry";
import { getPartsConsumptionReport } from "@/lib/services/reporting/reports/partsConsumptionReport";
import { getAssetSummaryReport } from "@/lib/services/reporting/reports/assetSummaryReport";
import { getCustomerSummaryReport } from "@/lib/services/reporting/reports/customerSummaryReport";
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
  parts?: any[];
  inventoryLocations?: any[];
  inventoryBalances?: any[];
  stockMovements?: any[];
  workOrderParts?: any[];
  assets?: any[];
  assetCategories?: any[];
  customers?: any[];
  workOrders?: any[];
  invoices?: any[];
}) {
  const parts = data.parts ?? [];
  const inventoryLocations = data.inventoryLocations ?? [];
  const inventoryBalances = data.inventoryBalances ?? [];
  const stockMovements = data.stockMovements ?? [];
  const workOrderParts = data.workOrderParts ?? [];
  const assets = data.assets ?? [];
  const assetCategories = data.assetCategories ?? [];
  const customers = data.customers ?? [];
  const workOrders = data.workOrders ?? [];
  const invoices = data.invoices ?? [];

  return {
    part: {
      findMany: async ({ where }: any = {}) => parts.filter((p) => matchesWhere(p, where)),
      findFirst: async ({ where }: any = {}) => parts.find((p) => matchesWhere(p, where)) ?? null,
    },
    inventoryLocation: {
      findMany: async ({ where }: any = {}) => inventoryLocations.filter((l) => matchesWhere(l, where)),
      findFirst: async ({ where }: any = {}) => inventoryLocations.find((l) => matchesWhere(l, where)) ?? null,
    },
    inventoryBalance: {
      findMany: async ({ where }: any = {}) => inventoryBalances.filter((b) => matchesWhere(b, where)),
    },
    stockMovement: {
      findMany: async ({ where }: any = {}) => stockMovements.filter((m) => matchesWhere(m, where)),
      count: async ({ where }: any = {}) => stockMovements.filter((m) => matchesWhere(m, where)).length,
    },
    workOrderPart: {
      findMany: async ({ where }: any = {}) => workOrderParts.filter((wop) => matchesWhere(wop, where)),
    },
    asset: {
      findMany: async ({ where }: any = {}) => assets.filter((a) => matchesWhere(a, where)),
      findFirst: async ({ where }: any = {}) => assets.find((a) => matchesWhere(a, where)) ?? null,
    },
    assetCategory: {
      findMany: async ({ where }: any = {}) => assetCategories.filter((ac) => matchesWhere(ac, where)),
      findFirst: async ({ where }: any = {}) => assetCategories.find((ac) => matchesWhere(ac, where)) ?? null,
    },
    customer: {
      findMany: async ({ where }: any = {}) => customers.filter((c) => matchesWhere(c, where)),
      findFirst: async ({ where }: any = {}) => customers.find((c) => matchesWhere(c, where)) ?? null,
    },
    workOrder: {
      findMany: async ({ where }: any = {}) => workOrders.filter((wo) => matchesWhere(wo, where)),
    },
    invoice: {
      findMany: async ({ where }: any = {}) => invoices.filter((i) => matchesWhere(i, where)),
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

// =========================================================================
// Test Suite
// =========================================================================
describe("Phase 1.14.7 — Inventory, Asset & Customer Metrics and Reports", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------

  // 1. Metric Registry Assertions & Value Types
  // -----------------------------------------------------------------------
  describe("1. Metric Registry Assertions & Value Types", () => {
    it("verifies inventory metric definitions and write-once date anchors", () => {
      const onHand = getMetricDefinition("inventory.quantityOnHand");
      expect(onHand.temporality).toBe("AS_OF");
      expect(onHand.valueType).toBe("SUM_QUANTITY");
      expect(onHand.dateAnchor).toBeNull();

      const consumed = getMetricDefinition("inventory.partsConsumedQuantity");
      expect(consumed.temporality).toBe("PERIOD");
      expect(consumed.dateAnchor).toEqual({ model: "WorkOrderPart", field: "consumedAt" });

      const consumedCost = getMetricDefinition("inventory.partsConsumedCost");
      expect(consumedCost.valueType).toBe("SUM_MONEY");
      expect(consumedCost.isSnapshotDerived).toBe(true);

      const movements = getMetricDefinition("inventory.stockMovementCount");
      expect(movements.temporality).toBe("PERIOD");
      expect(movements.dateAnchor).toEqual({ model: "StockMovement", field: "createdAt" });
    });

    it("verifies asset metric definitions and value types (AVG_COUNT & AVG_DURATION_HOURS)", () => {
      const count = getMetricDefinition("assets.count");
      expect(count.temporality).toBe("AS_OF");

      const serviceEvents = getMetricDefinition("assets.serviceEventCount");
      expect(serviceEvents.temporality).toBe("PERIOD");
      expect(serviceEvents.dateAnchor).toEqual({ model: "WorkOrder", field: "completedAt" });

      const avgServices = getMetricDefinition("assets.avgServicesPerAsset");
      expect(avgServices.temporality).toBe("PERIOD");
      expect(avgServices.valueType).toBe("AVG_COUNT");

      const mtbf = METRIC_REGISTRY["assets.mtbfHours"];
      expect(mtbf?.valueType).toBe("AVG_DURATION_HOURS");
    });

    it("verifies customer metric definitions and value types (AVG_COUNT)", () => {
      const active = getMetricDefinition("customers.activeCount");
      expect(active.temporality).toBe("AS_OF");

      const newCust = getMetricDefinition("customers.newCount");
      expect(newCust.temporality).toBe("PERIOD");
      expect(newCust.dateAnchor).toEqual({ model: "Customer", field: "createdAt" });

      const woPerCust = getMetricDefinition("customers.workOrdersPerCustomer");
      expect(woPerCust.temporality).toBe("PERIOD");
      expect(woPerCust.valueType).toBe("AVG_COUNT");
      expect(woPerCust.dateAnchor).toEqual({ model: "WorkOrder", field: "createdAt" });

      const ltv = getMetricDefinition("customers.lifetimeInvoicedRevenue");
      expect(ltv.temporality).toBe("AS_OF");
      expect(ltv.valueType).toBe("SUM_MONEY");

      const repeatRate = getMetricDefinition("customers.repeatCustomerRate");
      expect(repeatRate.temporality).toBe("PERIOD");
      expect(repeatRate.valueType).toBe("RATE_PERCENT");
      expect(repeatRate.dateAnchor).toEqual({ model: "WorkOrder", field: "completedAt" });
    });

    it("verifies Open-Closed 501 deferrals on metric definitions across all 3 domains", () => {
      expect(() => getMetricDefinition("inventory.stockValue")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("assets.mtbfHours")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("assets.mttrHours")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("assets.uptimePercentage")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("assets.downtimeMinutes")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("customers.churnRate")).toThrow(ReportMetricUnavailableError);
      expect(() => getMetricDefinition("customers.retentionRate")).toThrow(ReportMetricUnavailableError);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Inventory: Replay Reconciliation Invariant & Nullable Thresholds
  // -----------------------------------------------------------------------
  describe("2. Inventory: Replay Reconciliation & Stock Thresholds", () => {
    it("satisfies replay reconciliation invariant: replaying all movements to now matches live InventoryBalance exactly", async () => {
      const t0 = new Date("2026-01-01T10:00:00Z");
      const t1 = new Date("2026-01-05T10:00:00Z");
      const t2 = new Date("2026-01-10T10:00:00Z");
      const t3 = new Date("2026-01-15T10:00:00Z");
      const t4 = new Date("2026-01-20T10:00:00Z");
      const t5 = new Date("2026-01-25T10:00:00Z");

      // Initial Receipt: +100
      // Transfer In: +20
      // Transfer Out: -10
      // Adjustment: -5
      // Return: +15
      // Consumption: -30
      // Net Replay Expected: 100 + 20 - 10 - 5 + 15 - 30 = 90
      const stockMovements = [
        { id: "sm1", workspaceId: "ws_alpha", partId: "part_replay", movementType: "RECEIPT", quantity: 100, createdAt: t0 },
        { id: "sm2", workspaceId: "ws_alpha", partId: "part_replay", movementType: "TRANSFER_IN", quantity: 20, createdAt: t1 },
        { id: "sm3", workspaceId: "ws_alpha", partId: "part_replay", movementType: "TRANSFER_OUT", quantity: 10, createdAt: t2 },
        { id: "sm4", workspaceId: "ws_alpha", partId: "part_replay", movementType: "ADJUSTMENT", quantity: -5, createdAt: t3 },
        { id: "sm5", workspaceId: "ws_alpha", partId: "part_replay", movementType: "RETURN", quantity: 15, createdAt: t4 },
        { id: "sm6", workspaceId: "ws_alpha", partId: "part_replay", movementType: "CONSUMPTION", quantity: 30, createdAt: t5 },
      ];

      const inventoryBalances = [
        { workspaceId: "ws_alpha", partId: "part_replay", quantityOnHand: 90 },
      ];

      const mockDb: any = createPredicateEvaluatingDb({
        parts: [{ id: "part_replay", name: "Replay Part", workspaceId: "ws_alpha", status: "ACTIVE" }],
        stockMovements,
        inventoryBalances,
      });

      // 1. Historical replay to t5 (after all movements)
      const resReplay = await getPartsConsumptionReport("ws_alpha", { asOf: "2026-02-01T00:00:00Z" }, mockAdminContext, "inventory.partsConsumption", mockDb);
      const replayQty = (resReplay as any).values["inventory.quantityOnHand"];

      // 2. Live InventoryBalance query (now)
      const resLive = await getPartsConsumptionReport("ws_alpha", {}, mockAdminContext, "inventory.partsConsumption", mockDb);
      const liveQty = (resLive as any).values["inventory.quantityOnHand"];

      // INVARIANT: Historical Replay to end-of-chain == Live Balance
      expect(replayQty).toBe(90);
      expect(liveQty).toBe(90);
      expect(replayQty).toBe(liveQty);
    });

    it("evaluates low-stock threshold per-location vs aggregate workspace level", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        parts: [
          // Part 1: minStock = 10. Location 1 has 6, Location 2 has 6 (total on-hand = 12)
          { id: "p1", name: "Spark Plug", workspaceId: "ws_alpha", status: "ACTIVE", minimumStockLevel: 10.0 },
          // Part 2: minStock = null (unconfigured threshold -> MUST be excluded)
          { id: "p2", name: "Special Screw", workspaceId: "ws_alpha", status: "ACTIVE", minimumStockLevel: null },
        ],
        inventoryBalances: [
          { workspaceId: "ws_alpha", partId: "p1", locationId: "loc_van_1", quantityOnHand: 6.0 },
          { workspaceId: "ws_alpha", partId: "p1", locationId: "loc_warehouse", quantityOnHand: 6.0 },
          { workspaceId: "ws_alpha", partId: "p2", locationId: "loc_warehouse", quantityOnHand: 0.0 },
        ],
        inventoryLocations: [
          { id: "loc_van_1", workspaceId: "ws_alpha", name: "Van 1" },
          { id: "loc_warehouse", workspaceId: "ws_alpha", name: "Main Warehouse" },
        ],
      });

      // A. Aggregate workspace query: total on-hand is 12 > 10 minStock -> 0 parts below threshold
      const resAggregate = await getPartsConsumptionReport("ws_alpha", {}, mockAdminContext, "inventory.partsConsumption", mockDb);
      expect((resAggregate as any).values["inventory.belowMinimumStockPartCount"]).toBe(0);

      // B. Per-location query (loc_van_1): on-hand is 6 <= 10 minStock -> 1 part below threshold
      const resLocation = await getPartsConsumptionReport("ws_alpha", { inventoryLocationId: "loc_van_1" }, mockAdminContext, "inventory.partsConsumption", mockDb);
      expect((resLocation as any).values["inventory.belowMinimumStockPartCount"]).toBe(1);
    });

    it("excludes nullable thresholds (minimumStockLevel null on Part, warrantyExpiresAt null on Asset)", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        parts: [
          { id: "p_null_min", name: "Custom Gasket", workspaceId: "ws_alpha", status: "ACTIVE", minimumStockLevel: null },
        ],
        inventoryBalances: [
          { workspaceId: "ws_alpha", partId: "p_null_min", quantityOnHand: 0 },
        ],
        assets: [
          { id: "a_null_war", name: "Legacy Pump", workspaceId: "ws_alpha", status: "OPERATIONAL", warrantyExpiresAt: null },
        ],
      });

      const resInv = await getPartsConsumptionReport("ws_alpha", {}, mockAdminContext, "inventory.partsConsumption", mockDb);
      expect((resInv as any).values["inventory.belowMinimumStockPartCount"]).toBe(0);

      const resAsset = await getAssetSummaryReport("ws_alpha", {}, mockAdminContext, "asset.summary", mockDb);
      expect((resAsset as any).values["assets.warrantyExpiringCount"]).toBe(0);
    });

    it("computes parts consumed volume and monetary cost in pure Decimal", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        parts: [{ id: "p1", name: "Oil", workspaceId: "ws_alpha", status: "ACTIVE" }],
        inventoryBalances: [{ workspaceId: "ws_alpha", partId: "p1", quantityOnHand: 50.0 }],
        workOrderParts: [
          { id: "wop1", workspaceId: "ws_alpha", partId: "p1", quantity: 5.0, unitCostAtTimeOfUse: 12.50, consumedAt: new Date("2026-08-10T10:00:00Z") },
          { id: "wop2", workspaceId: "ws_alpha", partId: "p1", quantity: 3.0, unitCostAtTimeOfUse: 15.00, consumedAt: new Date("2026-08-15T10:00:00Z") },
        ],
        stockMovements: [
          { id: "sm1", workspaceId: "ws_alpha", partId: "p1", movementType: "CONSUMPTION", quantity: 5.0, createdAt: new Date("2026-08-10T10:00:00Z") },
          { id: "sm2", workspaceId: "ws_alpha", partId: "p1", movementType: "CONSUMPTION", quantity: 3.0, createdAt: new Date("2026-08-15T10:00:00Z") },
        ],
      });

      const res = await getPartsConsumptionReport("ws_alpha", { preset: "THIS_MONTH" }, mockAdminContext, "inventory.partsConsumption", mockDb);
      const values = (res as any).values;

      expect(values["inventory.partsConsumedQuantity"]).toBe(8);
      expect(values["inventory.partsConsumedCost"]).toBe("107.50");
      expect(values["inventory.stockMovementCount"]).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Asset: Warranty Boundary & Service Event Aggregation
  // -----------------------------------------------------------------------
  describe("3. Asset: Warranty Boundary & Service Events", () => {
    it("evaluates warranty expiration boundary at exactly ASSET_WARRANTY_WINDOW_DAYS = 90", async () => {
      const now = new Date();
      const addDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

      const mockDb: any = createPredicateEvaluatingDb({
        assets: [
          // Asset 1: expires in 89 days -> within 90 days (included)
          { id: "a1", name: "HVAC Unit 1", workspaceId: "ws_alpha", status: "OPERATIONAL", warrantyExpiresAt: addDays(89) },
          // Asset 2: expires in exactly 90 days -> boundary (included)
          { id: "a2", name: "HVAC Unit 2", workspaceId: "ws_alpha", status: "OPERATIONAL", warrantyExpiresAt: addDays(90) },
          // Asset 3: expires in 91 days -> beyond window (excluded)
          { id: "a3", name: "HVAC Unit 3", workspaceId: "ws_alpha", status: "OPERATIONAL", warrantyExpiresAt: addDays(91) },
          // Asset 4: already expired 10 days ago (excluded)
          { id: "a4", name: "HVAC Unit 4", workspaceId: "ws_alpha", status: "OPERATIONAL", warrantyExpiresAt: addDays(-10) },
        ],
      });

      const res = await getAssetSummaryReport("ws_alpha", {}, mockAdminContext, "asset.summary", mockDb);
      const values = (res as any).values;

      expect(values["assets.count"]).toBe(4);
      expect(values["assets.warrantyExpiringCount"]).toBe(2); // a1 and a2
    });

    it("aggregates completed maintenance work orders per asset as an average ratio (AVG_COUNT)", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        assets: [
          { id: "a1", name: "Chiller 1", workspaceId: "ws_alpha", status: "OPERATIONAL" },
          { id: "a2", name: "Chiller 2", workspaceId: "ws_alpha", status: "OPERATIONAL" },
        ],
        workOrders: [
          // a1 has 2 completed services
          { id: "wo1", workspaceId: "ws_alpha", assetId: "a1", status: "COMPLETED", completedAt: new Date("2026-08-05T10:00:00Z") },
          { id: "wo2", workspaceId: "ws_alpha", assetId: "a1", status: "COMPLETED", completedAt: new Date("2026-08-15T10:00:00Z") },
          // a2 has 1 completed service
          { id: "wo3", workspaceId: "ws_alpha", assetId: "a2", status: "COMPLETED", completedAt: new Date("2026-08-20T10:00:00Z") },
          // Cancelled work order (should be excluded)
          { id: "wo4", workspaceId: "ws_alpha", assetId: "a2", status: "CANCELLED", completedAt: null },
        ],
      });

      const res = await getAssetSummaryReport("ws_alpha", { preset: "THIS_MONTH" }, mockAdminContext, "asset.summary", mockDb);
      const values = (res as any).values;

      expect(values["assets.serviceEventCount"]).toBe(3);
      // 3 services / 2 distinct serviced assets = 1.5 services/asset (AVG_COUNT)
      expect(values["assets.avgServicesPerAsset"]).toBe(1.5);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Customer: Repeat Customer Boundary & Single-Currency LTV Rule
  // -----------------------------------------------------------------------
  describe("4. Customer: Repeat Customer Boundary & Single-Currency LTV", () => {
    it("evaluates repeat customer boundary at exactly 2 completed work orders", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        customers: [
          { id: "c1", name: "Customer One", workspaceId: "ws_alpha", status: "ACTIVE", createdAt: new Date("2026-08-01T10:00:00Z") },
          { id: "c2", name: "Customer Two", workspaceId: "ws_alpha", status: "ACTIVE", createdAt: new Date("2026-08-01T10:00:00Z") },
          { id: "c3", name: "Customer Three", workspaceId: "ws_alpha", status: "ACTIVE", createdAt: new Date("2026-08-01T10:00:00Z") },
        ],
        workOrders: [
          // Customer 1: 1 completed WO -> Single visit (NOT repeat)
          { id: "wo1", workspaceId: "ws_alpha", customerId: "c1", status: "COMPLETED", completedAt: new Date("2026-08-05T10:00:00Z") },
          // Customer 2: 2 completed WOs -> Boundary: exactly 2 completed WOs (IS repeat)
          { id: "wo2", workspaceId: "ws_alpha", customerId: "c2", status: "COMPLETED", completedAt: new Date("2026-08-06T10:00:00Z") },
          { id: "wo3", workspaceId: "ws_alpha", customerId: "c2", status: "COMPLETED", completedAt: new Date("2026-08-12T10:00:00Z") },
          // Customer 3: 3 completed WOs -> (IS repeat)
          { id: "wo4", workspaceId: "ws_alpha", customerId: "c3", status: "COMPLETED", completedAt: new Date("2026-08-07T10:00:00Z") },
          { id: "wo5", workspaceId: "ws_alpha", customerId: "c3", status: "COMPLETED", completedAt: new Date("2026-08-14T10:00:00Z") },
          { id: "wo6", workspaceId: "ws_alpha", customerId: "c3", status: "COMPLETED", completedAt: new Date("2026-08-21T10:00:00Z") },
        ],
        invoices: [],
      });

      const res = await getCustomerSummaryReport("ws_alpha", { preset: "THIS_MONTH" }, mockAdminContext, "customer.activitySummary", mockDb);
      const values = (res as any).values;

      // 3 serviced customers total; 2 repeat customers (c2 and c3) -> 2 / 3 = 66.67%
      expect(values["customers.repeatCustomerRate"]).toBe(66.67);
      expect(values["customers.activeCount"]).toBe(3);
    });

    it("enforces 1.14.6 single-currency rule on lifetime revenue and rejects mixed currency workspaces without filter", async () => {
      const mockDbMixed: any = createPredicateEvaluatingDb({
        customers: [{ id: "c1", name: "Global Corp", workspaceId: "ws_alpha", status: "ACTIVE" }],
        invoices: [
          { id: "inv1", customerId: "c1", workspaceId: "ws_alpha", status: "PAID", total: 100.00, currencyCode: "USD" },
          { id: "inv2", customerId: "c1", workspaceId: "ws_alpha", status: "PAID", total: 100.00, currencyCode: "EUR" },
        ],
      });

      // Mixed currency without currencyCode filter MUST throw ReportParameterValidationError
      await expect(
        getCustomerSummaryReport("ws_alpha", {}, mockAdminContext, "customer.activitySummary", mockDbMixed),
      ).rejects.toThrow(ReportParameterValidationError);

      // Filtered to USD succeeds
      const resUsd = await getCustomerSummaryReport("ws_alpha", { currencyCode: "USD" }, mockAdminContext, "customer.activitySummary", mockDbMixed);
      expect((resUsd as any).values["customers.lifetimeInvoicedRevenue"]).toBe("100.00");
    });

    it("aggregates customer lifetime invoiced revenue in pure Decimal snapshots with minimum PII", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        customers: [
          { id: "c1", name: "Alice Corp", customerNumber: "CUST-001", workspaceId: "ws_alpha", status: "ACTIVE", createdAt: new Date("2026-01-01T10:00:00Z") },
          { id: "c2", name: "Bob LLC", customerNumber: "CUST-002", workspaceId: "ws_alpha", status: "ACTIVE", createdAt: new Date("2026-01-01T10:00:00Z") },
        ],
        invoices: [
          { id: "inv1", customerId: "c1", workspaceId: "ws_alpha", status: "PAID", total: 500.25, currencyCode: "USD" },
          { id: "inv2", customerId: "c1", workspaceId: "ws_alpha", status: "ISSUED", total: 250.50, currencyCode: "USD" },
          { id: "inv3", customerId: "c2", workspaceId: "ws_alpha", status: "PAID", total: 1000.00, currencyCode: "USD" },
          // Draft invoice (must be excluded from lifetime revenue)
          { id: "inv4", customerId: "c2", workspaceId: "ws_alpha", status: "DRAFT", total: 300.00, currencyCode: "USD" },
        ],
      });

      const res = await getCustomerSummaryReport(
        "ws_alpha",
        { dimensions: ["customer"], sortBy: "customers.lifetimeInvoicedRevenue", sortOrder: "desc" },
        mockAdminContext,
        "customer.activitySummary",
        mockDb,
      );

      const items = (res as any).items;
      expect(items.length).toBe(2);
      const row0 = items[0];
      const row1 = items[1];

      // c2 lifetime = 1000.00
      expect(row0.dimensions.customer.key).toBe("c2");
      expect(row0.dimensions.customer.label).toBe("Bob LLC");
      expect((row0.values as any)["customers.lifetimeInvoicedRevenue"]).toBe("1000.00");

      // c1 lifetime = 500.25 + 250.50 = 750.75
      expect(row1.dimensions.customer.key).toBe("c1");
      expect(row1.dimensions.customer.label).toBe("Alice Corp");
      expect((row1.values as any)["customers.lifetimeInvoicedRevenue"]).toBe("750.75");
    });
  });

  // -----------------------------------------------------------------------
  // 5. Cardinality Cap & Deterministic Truncation with totalUncappedCount
  // -----------------------------------------------------------------------
  describe("5. Cardinality Cap & Deterministic Truncation with totalUncappedCount", () => {
    it("truncates at MAX_GROUP_CARDINALITY (1,000) returning explicit truncated signal, totalUncappedCount, and tie-break ordering", async () => {
      const parts: any[] = [];
      const balances: any[] = [];

      for (let i = 0; i < 1005; i++) {
        const id = `part_${String(i).padStart(4, "0")}`;
        parts.push({ id, name: `Part ${i}`, workspaceId: "ws_alpha", status: "ACTIVE" });
        balances.push({ workspaceId: "ws_alpha", partId: id, quantityOnHand: 10 });
      }

      const mockDb: any = createPredicateEvaluatingDb({ parts, inventoryBalances: balances });

      const res = await getPartsConsumptionReport(
        "ws_alpha",
        { dimensions: ["part"], sortBy: "inventory.quantityOnHand", sortOrder: "desc" },
        mockAdminContext,
        "inventory.partsConsumption",
        mockDb,
      );

      const items = (res as any).items;
      expect(items.length).toBe(1000);
      expect(res.meta.truncated).toBe(true);
      expect(res.meta.totalUncappedCount).toBe(1005);
      // Deterministic tie-break by ID
      expect(items[0].dimensions.part.key).toBe("part_0000");
      expect(items[999].dimensions.part.key).toBe("part_0999");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Zero-Activity Rows & Archived Entities
  // -----------------------------------------------------------------------
  describe("6. Zero-Activity Rows & Archived Entities", () => {
    it("preserves zero-activity parts and customers in grouped queries", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        parts: [
          { id: "p_active_used", name: "Used Part", workspaceId: "ws_alpha", status: "ACTIVE" },
          { id: "p_active_unused", name: "Unused Part", workspaceId: "ws_alpha", status: "ACTIVE" },
        ],
        inventoryBalances: [
          { workspaceId: "ws_alpha", partId: "p_active_used", quantityOnHand: 20 },
          { workspaceId: "ws_alpha", partId: "p_active_unused", quantityOnHand: 0 },
        ],
        workOrderParts: [
          { id: "wop1", workspaceId: "ws_alpha", partId: "p_active_used", quantity: 5, unitCostAtTimeOfUse: 10, consumedAt: new Date("2026-08-10T10:00:00Z") },
        ],
      });

      const res = await getPartsConsumptionReport(
        "ws_alpha",
        { dimensions: ["part"] },
        mockAdminContext,
        "inventory.partsConsumption",
        mockDb,
      );

      const items = (res as any).items;
      expect(items.length).toBe(2);
      const unusedRow = items.find((r: any) => r.dimensions.part.key === "p_active_unused");
      expect(unusedRow).toBeDefined();
      expect((unusedRow!.values as any)["inventory.partsConsumedQuantity"]).toBe(0);
      expect((unusedRow!.values as any)["inventory.quantityOnHand"]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Authorization Matrix & Role Denials across all 3 reports
  // -----------------------------------------------------------------------
  describe("7. Authorization Matrix & Role Denials across all 3 reports", () => {
    it("denies TECHNICIAN role on inventory report with 403", async () => {
      const mockDb: any = createPredicateEvaluatingDb({});
      await expect(
        getPartsConsumptionReport("ws_alpha", {}, mockTechnicianContext, "inventory.partsConsumption", mockDb),
      ).rejects.toThrow();
    });

    it("denies TECHNICIAN role on asset report with 403", async () => {
      const mockDb: any = createPredicateEvaluatingDb({});
      await expect(
        getAssetSummaryReport("ws_alpha", {}, mockTechnicianContext, "asset.summary", mockDb),
      ).rejects.toThrow();
    });

    it("denies TECHNICIAN role on customer report with 403", async () => {
      const mockDb: any = createPredicateEvaluatingDb({});
      await expect(
        getCustomerSummaryReport("ws_alpha", {}, mockTechnicianContext, "customer.activitySummary", mockDb),
      ).rejects.toThrow();
    });

    it("ensures foreign workspace inventory and customer data is invisible", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        parts: [
          { id: "p_local", name: "Local Part", workspaceId: "ws_alpha", status: "ACTIVE" },
          { id: "p_foreign", name: "Foreign Part", workspaceId: "ws_foreign", status: "ACTIVE" },
        ],
        inventoryBalances: [
          { workspaceId: "ws_alpha", partId: "p_local", quantityOnHand: 50 },
          { workspaceId: "ws_foreign", partId: "p_foreign", quantityOnHand: 10000 },
        ],
      });

      const res = await getPartsConsumptionReport("ws_alpha", {}, mockAdminContext, "inventory.partsConsumption", mockDb);
      const values = (res as any).values;
      expect(values["inventory.quantityOnHand"]).toBe(50);
    });
  });
});
