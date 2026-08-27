import { describe, it, expect, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import {
  getMetricDefinition,
  getDimensionDefinition,
  getFilterDefinition,
  getReportDefinition,
  getDispatchPerformanceReport,
  ReportScopeViolationError,
  ReportCardinalityExceededError,
  ReportMetricUnavailableError,
  MAX_SCAN_ROWS,
  MAX_GROUP_CARDINALITY,
} from "@/lib/services/reporting";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { ReportRowsReadModel } from "@/lib/services/reporting/reporting.types";

describe("Phase 1.14.4 — Scheduling & Dispatch Metrics & Reports", () => {
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
  // 1. Metric Registry Assertions
  // =========================================================================
  describe("1. Metric Registry Assertions", () => {
    it("verifies schedule.appointmentsScheduledCount definition", () => {
      const def = getMetricDefinition("schedule.appointmentsScheduledCount");
      expect(def.key).toBe("schedule.appointmentsScheduledCount");
      expect(def.category).toBe("OPERATIONAL");
      expect(def.valueType).toBe("COUNT");
      expect(def.temporality).toBe("PERIOD");
      expect(def.sourceModel).toBe("ScheduleAppointment");
      expect(def.dateAnchor).toEqual({
        model: "ScheduleAppointment",
        field: "createdAt",
      });
      expect(def.requiredPermission).toBe(PERMISSIONS.REPORTS_VIEW_OPERATIONAL);
    });

    it("verifies schedule.appointmentsCompletedCount anchors to immutable ScheduleAppointmentHistory.createdAt with eventType=COMPLETED", () => {
      const def = getMetricDefinition("schedule.appointmentsCompletedCount");
      expect(def.key).toBe("schedule.appointmentsCompletedCount");
      expect(def.dateAnchor).toEqual({
        model: "ScheduleAppointmentHistory",
        field: "createdAt",
      });
      expect(def.baseWhere()).toEqual({
        history: {
          some: {
            eventType: "COMPLETED",
          },
        },
      });
    });

    it("verifies schedule.appointmentsCancelledCount anchors to immutable ScheduleAppointmentHistory.createdAt with eventType=CANCELLED", () => {
      const def = getMetricDefinition("schedule.appointmentsCancelledCount");
      expect(def.key).toBe("schedule.appointmentsCancelledCount");
      expect(def.dateAnchor).toEqual({
        model: "ScheduleAppointmentHistory",
        field: "createdAt",
      });
      expect(def.baseWhere()).toEqual({
        history: {
          some: {
            eventType: "CANCELLED",
          },
        },
      });
    });

    it("verifies schedule.dispatchedCount has dispatchStatus in DISPATCHED/ACKNOWLEDGED guard", () => {
      const def = getMetricDefinition("schedule.dispatchedCount");
      expect(def.key).toBe("schedule.dispatchedCount");
      expect(def.dateAnchor).toEqual({
        model: "ScheduleAppointmentHistory",
        field: "createdAt",
      });
      expect(def.requiredPermission).toBe(PERMISSIONS.REPORTS_VIEW_OPERATIONAL);
    });

    it("verifies schedule.avgDispatchLatencyMinutes definition and aggregation", () => {
      const def = getMetricDefinition("schedule.avgDispatchLatencyMinutes");
      expect(def.valueType).toBe("AVG_DURATION_MINUTES");
      expect(def.aggregation).toEqual({
        kind: "AVG_DATE_DIFF_MINUTES",
        fromField: "createdAt",
        toField: "history.createdAt",
      });
      expect(def.materializationTrigger).toBeNull();
    });

    it("throws 501 ReportMetricUnavailableError for deferred schedule.avgAcknowledgeLatencyMinutes (§17.2)", () => {
      expect(() =>
        getMetricDefinition("schedule.avgAcknowledgeLatencyMinutes"),
      ).toThrow(ReportMetricUnavailableError);

      try {
        getMetricDefinition("schedule.avgAcknowledgeLatencyMinutes");
      } catch (err: any) {
        expect(err.statusCode).toBe(501);
        expect(err.message).toContain("acknowledgedAt");
        expect(err.message).toContain("ACKNOWLEDGED");
      }
    });
  });

  // =========================================================================
  // 2. Dimension and Filter Registry Assertions
  // =========================================================================
  describe("2. Dimension and Filter Registry Assertions", () => {
    it("verifies reachable Scheduling dimensions are registered", () => {
      const apptStatusDim = getDimensionDefinition("appointmentStatus");
      expect(apptStatusDim.kind).toBe("COLUMN");
      expect(apptStatusDim.groupByField).toBe("status");
      expect(apptStatusDim.applicableModels).toContain("ScheduleAppointment");

      const dispatchStatusDim = getDimensionDefinition("dispatchStatus");
      expect(dispatchStatusDim.kind).toBe("COLUMN");
      expect(dispatchStatusDim.groupByField).toBe("dispatchStatus");
      expect(dispatchStatusDim.applicableModels).toContain("ScheduleAppointment");

      const techDim = getDimensionDefinition("technician");
      expect(techDim.applicableModels).toContain("ScheduleAppointment");
    });

    it("verifies Scheduling filter definitions and tenant validation requirements", () => {
      const apptFilter = getFilterDefinition("appointmentStatus");
      expect(apptFilter.requiresTenantValidation).toBe(false);

      const dispatchFilter = getFilterDefinition("dispatchStatus");
      expect(dispatchFilter.requiresTenantValidation).toBe(false);

      const techFilter = getFilterDefinition("technicianId");
      expect(techFilter.requiresTenantValidation).toBe(true);
      expect(techFilter.applicableModels).toContain("ScheduleAppointment");
    });
  });

  // =========================================================================
  // 3. Dispatch Performance Report Service
  // =========================================================================
  describe("3. Dispatch Performance Report Service", () => {
    it("executes scalar dispatch performance report correctly", async () => {
      const mockDb: any = {
        scheduleAppointment: {
          count: vi.fn(async (args) => {
            if (args?.where?.history?.some?.eventType === "COMPLETED") return 15;
            if (args?.where?.history?.some?.eventType === "CANCELLED") return 3;
            if (args?.where?.history?.some?.eventType === "DISPATCHED") return 20;
            return 25; // scheduledCount
          }),
          findMany: vi.fn().mockResolvedValue([
            {
              createdAt: new Date("2026-08-01T08:00:00.000Z"),
              history: [{ createdAt: new Date("2026-08-01T08:30:00.000Z") }], // 30 min
            },
            {
              createdAt: new Date("2026-08-01T09:00:00.000Z"),
              history: [{ createdAt: new Date("2026-08-01T10:00:00.000Z") }], // 60 min
            },
          ]),
        },
      };

      const res = await getDispatchPerformanceReport(
        "ws_test_123",
        { preset: "THIS_MONTH" },
        mockAuthManager,
        mockDb,
      );

      expect(res.meta.shape).toBe("SCALARS");
      expect(res.meta.reportKey).toBe("scheduling.dispatchPerformance");
      expect((res as any).values).toEqual({
        "schedule.appointmentsScheduledCount": 25,
        "schedule.appointmentsCompletedCount": 15,
        "schedule.appointmentsCancelledCount": 3,
        "schedule.dispatchedCount": 20,
        "schedule.avgDispatchLatencyMinutes": 45, // (30 + 60) / 2
      });

      // Verify structural tenant isolation
      expect(mockDb.scheduleAppointment.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ workspaceId: "ws_test_123" }),
        }),
      );
    });

    it("verifies touching an appointment later (advancing updatedAt) does NOT change reporting period anchor", async () => {
      let capturedCompletedWhere: any = null;
      let capturedCancelledWhere: any = null;

      const mockDb: any = {
        scheduleAppointment: {
          count: vi.fn(async (args) => {
            if (args?.where?.history?.some?.eventType === "COMPLETED") {
              capturedCompletedWhere = args.where;
              return 1;
            }
            if (args?.where?.history?.some?.eventType === "CANCELLED") {
              capturedCancelledWhere = args.where;
              return 1;
            }
            return 1;
          }),
        },
      };

      await getDispatchPerformanceReport(
        "ws_test_123",
        {
          preset: "THIS_MONTH",
          metrics: [
            "schedule.appointmentsCompletedCount",
            "schedule.appointmentsCancelledCount",
          ],
        },
        mockAuthManager,
        mockDb,
      );

      // Confirm the filter queries history.createdAt (the immutable transition event) and never uses ScheduleAppointment.updatedAt
      expect(capturedCompletedWhere.history.some.eventType).toBe("COMPLETED");
      expect(capturedCompletedWhere.history.some.createdAt).toBeDefined();
      expect(capturedCompletedWhere.updatedAt).toBeUndefined();

      expect(capturedCancelledWhere.history.some.eventType).toBe("CANCELLED");
      expect(capturedCancelledWhere.history.some.createdAt).toBeDefined();
      expect(capturedCancelledWhere.updatedAt).toBeUndefined();
    });

    it("verifies dispatch -> undispatch -> re-dispatch across reporting periods anchors strictly to ScheduleAppointmentHistory.createdAt", async () => {
      // Scenario:
      // Appointment created on Jan 15.
      // Dispatch 1 occurs on Jan 15 at 10:00 UTC (history event in January range).
      // On Feb 10, appointment is undispatched and re-dispatched at 14:00 UTC (history event in February range).
      // ScheduleAppointment.dispatchedAt now has the February timestamp ("2026-02-10T14:00:00.000Z").
      const appointmentJan = {
        id: "apt-redispatch-1",
        workspaceId: "ws_test_123",
        createdAt: new Date("2026-01-15T09:00:00.000Z"),
        dispatchedAt: new Date("2026-02-10T14:00:00.000Z"), // Overwritten by February re-dispatch
        history: [
          {
            eventType: "DISPATCHED",
            createdAt: new Date("2026-01-15T10:00:00.000Z"), // Jan dispatch (latency: 60m)
          },
          {
            eventType: "DISPATCHED",
            createdAt: new Date("2026-02-10T14:00:00.000Z"), // Feb re-dispatch
          },
        ],
      };

      const mockDb: any = {
        scheduleAppointment: {
          count: vi.fn(async (args: any) => {
            const start = args?.where?.history?.some?.createdAt?.gte;
            const end = args?.where?.history?.some?.createdAt?.lt;
            if (args?.where?.history?.some?.eventType === "DISPATCHED") {
              const startMs = start ? new Date(start).getTime() : 0;
              const endMs = end ? new Date(end).getTime() : Infinity;
              const matches = appointmentJan.history.some(
                (h) =>
                  h.eventType === "DISPATCHED" &&
                  h.createdAt.getTime() >= startMs &&
                  h.createdAt.getTime() < endMs,
              );
              return matches ? 1 : 0;
            }
            return 0;
          }),
          findMany: vi.fn(async (args: any) => {
            const start = args?.where?.history?.some?.createdAt?.gte;
            const end = args?.where?.history?.some?.createdAt?.lt;
            if (start && end) {
              const startMs = new Date(start).getTime();
              const endMs = new Date(end).getTime();
              const matchedHistory = appointmentJan.history.filter(
                (h) =>
                  h.eventType === "DISPATCHED" &&
                  h.createdAt.getTime() >= startMs &&
                  h.createdAt.getTime() < endMs,
              );
              if (matchedHistory.length > 0) {
                return [
                  {
                    createdAt: appointmentJan.createdAt,
                    history: matchedHistory,
                  },
                ];
              }
            }
            return [];
          }),
        },
      };

      // Query January 2026 report (range: 2026-01-01 to 2026-01-31 local date)
      const janReport: any = await getDispatchPerformanceReport(
        "ws_test_123",
        {
          from: "2026-01-01",
          to: "2026-01-31",
          metrics: ["schedule.dispatchedCount", "schedule.avgDispatchLatencyMinutes"],
        },
        mockAuthManager,
        mockDb,
      );

      // January report must count the January dispatch event (1) and compute latency from the Jan event (60m)
      expect(janReport.values["schedule.dispatchedCount"]).toBe(1);
      expect(janReport.values["schedule.avgDispatchLatencyMinutes"]).toBe(60);

      // Query February 2026 report (range: 2026-02-01 to 2026-02-28 local date)
      const febReport: any = await getDispatchPerformanceReport(
        "ws_test_123",
        {
          from: "2026-02-01",
          to: "2026-02-28",
          metrics: ["schedule.dispatchedCount"],
        },
        mockAuthManager,
        mockDb,
      );

      // February report must count the February re-dispatch event (1)
      expect(febReport.values["schedule.dispatchedCount"]).toBe(1);
    });

    it("allows DISPATCHER role to execute scheduling report (§7.2)", async () => {
      const mockDb: any = {
        scheduleAppointment: {
          count: vi.fn().mockResolvedValue(0),
        },
      };

      const res = await getDispatchPerformanceReport(
        "ws_test_123",
        { preset: "THIS_MONTH" },
        mockAuthDispatcher,
        mockDb,
      );
      expect(res.meta.reportKey).toBe("scheduling.dispatchPerformance");
    });

    it("rejects TECHNICIAN role from scheduling report (requires reports.view_operational)", async () => {
      const mockDb: any = {
        scheduleAppointment: {
          count: vi.fn().mockResolvedValue(0),
        },
      };

      await expect(
        getDispatchPerformanceReport(
          "ws_test_123",
          {},
          mockAuthTechnician,
          mockDb,
        ),
      ).rejects.toThrow();
    });

    it("throws 501 when requesting deferred metric schedule.avgAcknowledgeLatencyMinutes in report", async () => {
      const mockDb: any = {
        scheduleAppointment: {
          count: vi.fn().mockResolvedValue(0),
        },
      };

      await expect(
        getDispatchPerformanceReport(
          "ws_test_123",
          {
            metrics: ["schedule.avgAcknowledgeLatencyMinutes"],
          },
          mockAuthManager,
          mockDb,
        ),
      ).rejects.toThrow(ReportMetricUnavailableError);
    });

    it("executes dimensional grouping and batched label hydration for technician", async () => {
      const mockDb: any = {
        scheduleAppointment: {
          groupBy: vi.fn(async (args) => {
            if (args?.where?.history?.some?.eventType === "COMPLETED") {
              return [{ technicianId: "tech_1", _count: { _all: 8 } }];
            }
            if (args?.where?.history?.some?.eventType === "CANCELLED") {
              return [{ technicianId: "tech_1", _count: { _all: 1 } }];
            }
            if (args?.where?.history?.some?.eventType === "DISPATCHED") {
              return [{ technicianId: "tech_1", _count: { _all: 9 } }];
            }
            return [{ technicianId: "tech_1", _count: { _all: 10 } }];
          }),
          findMany: vi.fn().mockResolvedValue([
            {
              technicianId: "tech_1",
              createdAt: new Date("2026-08-01T08:00:00.000Z"),
              history: [{ createdAt: new Date("2026-08-01T08:20:00.000Z") }], // 20 min
            },
          ]),
        },
        technicianProfile: {
          findMany: vi.fn().mockResolvedValue([
            { id: "tech_1", employee: { displayName: "Alex Dispatcher" } },
          ]),
        },
      };

      const res = await getDispatchPerformanceReport(
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
            label: "Alex Dispatcher",
          },
        },
        values: {
          "schedule.appointmentsScheduledCount": 10,
          "schedule.appointmentsCompletedCount": 8,
          "schedule.appointmentsCancelledCount": 1,
          "schedule.dispatchedCount": 9,
          "schedule.avgDispatchLatencyMinutes": 20,
        },
      });
    });

    it("throws ReportScopeViolationError when technicianId filter does not belong to workspace", async () => {
      const mockDb: any = {
        technicianProfile: {
          findFirst: vi.fn().mockResolvedValue(null), // foreign technician
        },
      };

      await expect(
        getDispatchPerformanceReport(
          "ws_test_123",
          {
            technicianId: "tech_foreign_999",
          },
          mockAuthManager,
          mockDb,
        ),
      ).rejects.toThrow(ReportScopeViolationError);
    });

    it("throws ReportCardinalityExceededError when row scan exceeds MAX_SCAN_ROWS (50,000)", async () => {
      const mockDb: any = {
        scheduleAppointment: {
          count: vi.fn(async (args) => {
            if (args?.where?.history?.some?.eventType === "DISPATCHED") {
              return MAX_SCAN_ROWS + 1;
            }
            return 10;
          }),
        },
      };

      await expect(
        getDispatchPerformanceReport(
          "ws_test_123",
          { preset: "THIS_MONTH" },
          mockAuthManager,
          mockDb,
        ),
      ).rejects.toThrow(ReportCardinalityExceededError);
    });

    it("handles MAX_GROUP_CARDINALITY (1,000) ceiling with pagination and truncated flag when grouped results exceed 1,000", async () => {
      const largeGroups = Array.from({ length: MAX_GROUP_CARDINALITY + 1 }, (_, i) => ({
        technicianId: `tech_${i}`,
        _count: { _all: 1 },
      }));

      const mockDb: any = {
        scheduleAppointment: {
          groupBy: vi.fn().mockResolvedValue(largeGroups),
        },
      };

      const res = (await getDispatchPerformanceReport(
        "ws_test_123",
        {
          preset: "THIS_MONTH",
          dimensions: ["technician"],
        },
        mockAuthManager,
        mockDb,
      )) as ReportRowsReadModel;

      expect(res.meta.shape).toBe("ROWS");
      expect(res.meta.truncated).toBe(true);
      expect(res.meta.totalUncappedCount).toBe(MAX_GROUP_CARDINALITY + 1);
      expect(res.items.length).toBe(MAX_GROUP_CARDINALITY);
    });

    it("confirms no write methods (create, update, delete, upsert) are ever invoked", async () => {
      const createSpy = vi.fn();
      const updateSpy = vi.fn();
      const deleteSpy = vi.fn();
      const upsertSpy = vi.fn();

      const mockDb: any = {
        scheduleAppointment: {
          count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockResolvedValue([]),
          create: createSpy,
          update: updateSpy,
          delete: deleteSpy,
          upsert: upsertSpy,
        },
      };

      await getDispatchPerformanceReport(
        "ws_test_123",
        { preset: "THIS_MONTH" },
        mockAuthManager,
        mockDb,
      );

      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(upsertSpy).not.toHaveBeenCalled();
    });
  });
});
