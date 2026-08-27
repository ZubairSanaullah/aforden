import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));
import {
  getMetricDefinition,
  getDimensionDefinition,
  getFilterDefinition,
  getReportDefinition,
  getWorkOrderVolumeReport,
  getWorkOrderThroughputReport,
  OPEN_WORK_ORDER_STATUSES,
  ReportScopeViolationError,
  ReportCardinalityExceededError,
  UnknownMetricError,
  UnknownDimensionError,
  UnsupportedMetricDimensionCombinationError,
  MAX_SCAN_ROWS,
  MAX_GROUP_CARDINALITY,
} from "@/lib/services/reporting";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { ReportRowsReadModel } from "@/lib/services/reporting/reporting.types";

describe("Phase 1.14.3 — Operational Metrics & Work Order Reports", () => {
  const mockAuthManager: WorkspaceAuthorizationContext = {
    user: { id: "user_manager_1", email: "manager@test.com" } as any,
    membership: { id: "mem_mgr_1", role: "MANAGER" } as any,
    workspace: { id: "ws_test_123", name: "Test Corp", slug: "test-corp", timezone: "Asia/Karachi" } as any,
  };

  const mockAuthDispatcher: WorkspaceAuthorizationContext = {
    user: { id: "user_disp_1", email: "dispatcher@test.com" } as any,
    membership: { id: "mem_disp_1", role: "DISPATCHER" } as any,
    workspace: { id: "ws_test_123", name: "Test Corp", slug: "test-corp", timezone: "Asia/Karachi" } as any,
  };

  const mockAuthTechnician: WorkspaceAuthorizationContext = {
    user: { id: "user_tech_1", email: "tech@test.com" } as any,
    membership: { id: "mem_tech_1", role: "TECHNICIAN" } as any,
    workspace: { id: "ws_test_123", name: "Test Corp", slug: "test-corp", timezone: "Asia/Karachi" } as any,
  };

  // =========================================================================
  // 1. Metric Registry Population Verification
  // =========================================================================
  describe("1. Metric Registry Population", () => {
    it("verifies workOrders.createdCount definition", () => {
      const def = getMetricDefinition("workOrders.createdCount");
      expect(def.key).toBe("workOrders.createdCount");
      expect(def.category).toBe("OPERATIONAL");
      expect(def.valueType).toBe("COUNT");
      expect(def.temporality).toBe("PERIOD");
      expect(def.sourceModel).toBe("WorkOrder");
      expect(def.dateAnchor).toEqual({ model: "WorkOrder", field: "createdAt" });
      expect(def.requiredPermission).toBe(PERMISSIONS.REPORTS_VIEW_OPERATIONAL);
      expect(def.isSnapshotDerived).toBe(false);
      expect(def.materializationTrigger).toBeNull();
    });

    it("verifies workOrders.completedCount has the mandatory status=COMPLETED guard (§11.3)", () => {
      const def = getMetricDefinition("workOrders.completedCount");
      expect(def.key).toBe("workOrders.completedCount");
      expect(def.category).toBe("OPERATIONAL");
      expect(def.temporality).toBe("PERIOD");
      expect(def.dateAnchor).toEqual({ model: "WorkOrder", field: "completedAt" });
      // Mandatory guard
      expect(def.baseWhere()).toEqual({ status: "COMPLETED" });
    });

    it("verifies workOrders.cancelledCount has status=CANCELLED guard", () => {
      const def = getMetricDefinition("workOrders.cancelledCount");
      expect(def.key).toBe("workOrders.cancelledCount");
      expect(def.dateAnchor).toEqual({ model: "WorkOrder", field: "cancelledAt" });
      expect(def.baseWhere()).toEqual({ status: "CANCELLED" });
    });

    it("verifies workOrders.openBacklogCount is POINT_IN_TIME with non-terminal statuses", () => {
      const def = getMetricDefinition("workOrders.openBacklogCount");
      expect(def.temporality).toBe("POINT_IN_TIME");
      expect(def.dateAnchor).toBeNull();
      expect(OPEN_WORK_ORDER_STATUSES).toEqual(["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"]);
      expect(def.baseWhere()).toEqual({
        status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
      });
      // Point-in-time metrics cannot be broken down by time.* dimensions (§2.4)
      expect(def.supportedDimensions).not.toContain("time.day");
      expect(def.supportedDimensions).not.toContain("time.month");
    });

    it("verifies workOrders.completionRate is RATE sharing the same period", () => {
      const def = getMetricDefinition("workOrders.completionRate");
      expect(def.valueType).toBe("RATE_PERCENT");
      expect(def.aggregation).toEqual({
        kind: "RATE",
        numerator: "workOrders.completedCount",
        denominator: "workOrders.createdCount",
      });
    });

    it("verifies workOrders.avgCycleTimeMinutes carries the materialization trigger (§4.5)", () => {
      const def = getMetricDefinition("workOrders.avgCycleTimeMinutes");
      expect(def.valueType).toBe("AVG_DURATION_MINUTES");
      expect(def.materializationTrigger).toBeDefined();
      expect(def.materializationTrigger!.thresholdName).toBe("WORK_ORDER_ROWS_PER_WORKSPACE");
      expect(def.materializationTrigger!.thresholdValue).toBe(250_000);
    });
  });

  // =========================================================================
  // 2. Dimension & Filter Registry Verification
  // =========================================================================
  describe("2. Dimension & Filter Registry", () => {
    it("verifies all reachable WorkOrder dimensions are registered", () => {
      const techDim = getDimensionDefinition("technician");
      expect(techDim.kind).toBe("RELATION_ID");
      expect(techDim.groupByField).toBe("assignedTechnicianId");

      const wtDim = getDimensionDefinition("workType");
      expect(wtDim.kind).toBe("RELATION_ID");
      expect(wtDim.groupByField).toBe("workTypeId");

      const statusDim = getDimensionDefinition("workOrderStatus");
      expect(statusDim.kind).toBe("COLUMN");
      expect(statusDim.groupByField).toBe("status");

      const custDim = getDimensionDefinition("customer");
      expect(custDim.cardinalityClass).toBe("HIGH");

      const timeMonth = getDimensionDefinition("time.month");
      expect(timeMonth.kind).toBe("DATE_BUCKET");
    });

    it("verifies WorkOrder filter definitions and tenant validation requirements", () => {
      const custFilter = getFilterDefinition("customerId");
      expect(custFilter.requiresTenantValidation).toBe(true);

      const techFilter = getFilterDefinition("technicianId");
      expect(techFilter.requiresTenantValidation).toBe(true);

      const statusFilter = getFilterDefinition("workOrderStatus");
      expect(statusFilter.requiresTenantValidation).toBe(false);
      expect(statusFilter.valueType).toBe("ENUM");
    });

    it("throws UnknownMetricError / UnknownDimensionError for unregistered keys", () => {
      expect(() => getMetricDefinition("unregistered.fakeMetric" as any)).toThrow(UnknownMetricError);
      expect(() => getDimensionDefinition("unregistered.fakeDimension" as any)).toThrow(UnknownDimensionError);
    });
  });

  // =========================================================================
  // 3. Work Order Volume Report (`operational.workOrderVolume`)
  // =========================================================================
  describe("3. Work Order Volume Report Service", () => {
    it("executes scalar volume report correctly", async () => {
      const mockDb: any = {
        workOrder: {
          count: vi.fn(async (args) => {
            if (args?.where?.status === "COMPLETED") return 40;
            if (args?.where?.status === "CANCELLED") return 5;
            return 50; // created
          }),
        },
      };

      const res = await getWorkOrderVolumeReport(
        "ws_test_123",
        { preset: "THIS_MONTH" },
        mockAuthManager,
        mockDb,
      );

      expect(res.meta.shape).toBe("SCALARS");
      expect(res.meta.reportKey).toBe("operational.workOrderVolume");
      expect(res.meta.range).toBeDefined();
      expect((res as any).values).toEqual({
        "workOrders.createdCount": 50,
        "workOrders.completedCount": 40,
        "workOrders.cancelledCount": 5,
        "workOrders.completionRate": 80, // (40 / 50) * 100
      });

      // Verify completion query contains status = "COMPLETED" guard
      const completedCall = mockDb.workOrder.count.mock.calls.find(
        (call: any) => call[0]?.where?.status === "COMPLETED",
      );
      expect(completedCall).toBeDefined();
      expect(completedCall[0].where.completedAt).toBeDefined();
    });

    it("allows DISPATCHER role to execute operational volume report (§7.2)", async () => {
      const mockDb: any = {
        workOrder: {
          count: vi.fn().mockResolvedValue(10),
        },
      };

      const res = await getWorkOrderVolumeReport(
        "ws_test_123",
        { preset: "THIS_WEEK" },
        mockAuthDispatcher,
        mockDb,
      );
      expect(res.meta.reportKey).toBe("operational.workOrderVolume");
    });

    it("rejects TECHNICIAN role from operational volume report (requires reports.view_operational)", async () => {
      const mockDb: any = {};
      await expect(
        getWorkOrderVolumeReport("ws_test_123", {}, mockAuthTechnician, mockDb),
      ).rejects.toThrow();
    });

    it("executes dimensional grouping and batched label hydration for technician", async () => {
      const mockDb: any = {
        workOrder: {
          groupBy: vi.fn(async (args) => {
            if (args?.where?.status === "COMPLETED") {
              return [{ assignedTechnicianId: "tech_1", _count: { _all: 8 } }];
            }
            if (args?.where?.status === "CANCELLED") {
              return [{ assignedTechnicianId: "tech_1", _count: { _all: 1 } }];
            }
            return [{ assignedTechnicianId: "tech_1", _count: { _all: 10 } }];
          }),
        },
        technicianProfile: {
          findMany: vi.fn().mockResolvedValue([
            { id: "tech_1", employee: { displayName: "John Tech" } },
          ]),
        },
      };

      const res = await getWorkOrderVolumeReport(
        "ws_test_123",
        {
          preset: "THIS_MONTH",
          dimensions: ["technician"],
        },
        mockAuthManager,
        mockDb,
      );

      expect(res.meta.shape).toBe("ROWS");
      const rowsRes = res as any;
      expect(rowsRes.items.length).toBe(1);
      expect(rowsRes.items[0]).toEqual({
        dimensions: {
          technician: {
            key: "tech_1",
            label: "John Tech",
          },
        },
        values: {
          "workOrders.createdCount": 10,
          "workOrders.completedCount": 8,
          "workOrders.cancelledCount": 1,
          "workOrders.completionRate": 80,
        },
      });

      // Confirm label hydration was batched with 1 query
      expect(mockDb.technicianProfile.findMany).toHaveBeenCalledTimes(1);
    });

    it("throws ReportScopeViolationError when filter ID does not belong to workspace", async () => {
      const mockDb: any = {
        customer: {
          findFirst: vi.fn().mockResolvedValue(null), // foreign customer
        },
      };

      await expect(
        getWorkOrderVolumeReport(
          "ws_test_123",
          {
            customerId: "cust_foreign_999",
          },
          mockAuthManager,
          mockDb,
        ),
      ).rejects.toThrow(ReportScopeViolationError);
    });
  });

  // =========================================================================
  // 4. Work Order Throughput Report (`operational.workOrderThroughput`)
  // =========================================================================
  describe("4. Work Order Throughput Report Service", () => {
    it("computes average cycle time accurately in minutes", async () => {
      const createdAt = new Date("2026-08-01T10:00:00.000Z");
      const completedAt = new Date("2026-08-01T12:30:00.000Z"); // 150 minutes

      const mockDb: any = {
        workOrder: {
          count: vi.fn().mockResolvedValue(2),
          findMany: vi.fn().mockResolvedValue([
            { createdAt, completedAt },
            {
              createdAt: new Date("2026-08-02T08:00:00.000Z"),
              completedAt: new Date("2026-08-02T09:00:00.000Z"), // 60 minutes
            },
          ]),
        },
      };

      const res = await getWorkOrderThroughputReport(
        "ws_test_123",
        { preset: "THIS_MONTH" },
        mockAuthManager,
        mockDb,
      );

      expect(res.meta.shape).toBe("SCALARS");
      // Average of 150m and 60m is 105.00m
      expect((res as any).values).toEqual({
        "workOrders.completedCount": 2,
        "workOrders.avgCycleTimeMinutes": 105,
      });
    });

    it("throws ReportCardinalityExceededError when row scan exceeds MAX_SCAN_ROWS (50,000)", async () => {
      const mockDb: any = {
        workOrder: {
          count: vi.fn().mockResolvedValue(MAX_SCAN_ROWS + 5),
        },
      };

      await expect(
        getWorkOrderThroughputReport(
          "ws_test_123",
          { preset: "THIS_YEAR" },
          mockAuthManager,
          mockDb,
        ),
      ).rejects.toThrow(ReportCardinalityExceededError);
    });

    it("handles MAX_GROUP_CARDINALITY (1,000) ceiling with pagination and truncated flag when grouped results exceed 1,000", async () => {
      const largeGroups = Array.from({ length: MAX_GROUP_CARDINALITY + 10 }, (_, i) => ({
        workTypeId: `wt_${i}`,
        _count: { _all: 1 },
      }));

      const mockDb: any = {
        workOrder: {
          groupBy: vi.fn().mockResolvedValue(largeGroups),
        },
      };

      const res = (await getWorkOrderThroughputReport(
        "ws_test_123",
        {
          preset: "THIS_MONTH",
          dimensions: ["workType"],
        },
        mockAuthManager,
        mockDb,
      )) as ReportRowsReadModel;

      expect(res.meta.shape).toBe("ROWS");
      expect(res.meta.truncated).toBe(true);
      expect(res.meta.totalUncappedCount).toBe(MAX_GROUP_CARDINALITY + 10);
      expect(res.items.length).toBe(MAX_GROUP_CARDINALITY);
    });
  });

  // =========================================================================
  // 5. Read-Only Invariant Enforcement
  // =========================================================================
  describe("5. Read-Only Invariant Enforcement", () => {
    it("confirms no write methods (create, update, delete, upsert) are ever invoked", async () => {
      const mockDb: any = {
        workOrder: {
          count: vi.fn().mockResolvedValue(10),
          groupBy: vi.fn().mockResolvedValue([]),
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          upsert: vi.fn(),
        },
      };

      await getWorkOrderVolumeReport("ws_test_123", {}, mockAuthManager, mockDb);
      await getWorkOrderThroughputReport("ws_test_123", {}, mockAuthManager, mockDb);

      expect(mockDb.workOrder.create).not.toHaveBeenCalled();
      expect(mockDb.workOrder.update).not.toHaveBeenCalled();
      expect(mockDb.workOrder.delete).not.toHaveBeenCalled();
      expect(mockDb.workOrder.upsert).not.toHaveBeenCalled();
    });
  });
});
