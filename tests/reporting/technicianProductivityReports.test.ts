import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import {
  getMetricDefinition,
  getReportDefinition,
  getTechnicianProductivityReport,
  ReportScopeViolationError,
  ReportMetricUnavailableError,
  ReportCardinalityExceededError,
} from "@/lib/services/reporting";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Evaluates Prisma WHERE clause against in-memory fixture objects.
 * Guarantees that tests fail if queries omit required predicates.
 */
function matchesWhere(item: any, where: any): boolean {
  if (!where) return true;
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue;
    if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      const obj = val as any;
      if ("in" in obj) {
        if (!Array.isArray(obj.in) || !obj.in.includes(item[key])) return false;
      }
      if ("gte" in obj) {
        const itemVal = item[key] ? new Date(item[key]).getTime() : 0;
        const gteVal = new Date(obj.gte).getTime();
        if (itemVal < gteVal) return false;
      }
      if ("lt" in obj) {
        const itemVal = item[key] ? new Date(item[key]).getTime() : 0;
        const ltVal = new Date(obj.lt).getTime();
        if (itemVal >= ltVal) return false;
      }
      if ("not" in obj) {
        if (obj.not === null && (item[key] === null || item[key] === undefined)) return false;
      }
    } else if (item[key] !== val) {
      return false;
    }
  }
  return true;
}

function createPredicateEvaluatingDb(fixtures: {
  technicianProfiles?: any[];
  employees?: any[];
  workOrders?: any[];
  technicianTimeEntries?: any[];
  scheduleAppointments?: any[];
  workOrderHistories?: any[];
}) {
  const techProfiles = fixtures.technicianProfiles ?? [];
  const employees = fixtures.employees ?? [];
  const workOrders = fixtures.workOrders ?? [];
  const timeEntries = fixtures.technicianTimeEntries ?? [];
  const scheduleAppointments = fixtures.scheduleAppointments ?? [];
  const histories = fixtures.workOrderHistories ?? [];

  return {
    technicianProfile: {
      findMany: vi.fn(async (args?: any) => {
        return techProfiles.filter((p) => {
          if (args?.where?.id?.in && !args.where.id.in.includes(p.id)) return false;
          if (args?.where?.employee?.workspaceId && p.employee?.workspaceId !== args.where.employee.workspaceId) return false;
          return true;
        });
      }),
    },
    employee: {
      findFirst: vi.fn(async (args?: any) => {
        return employees.find((e) => matchesWhere(e, args?.where)) ?? null;
      }),
      findMany: vi.fn(async (args?: any) => {
        return employees.filter((e) => matchesWhere(e, args?.where));
      }),
    },
    workOrder: {
      findMany: vi.fn(async (args?: any) => {
        return workOrders.filter((wo) => matchesWhere(wo, args?.where));
      }),
      groupBy: vi.fn(async (args?: any) => {
        const filtered = workOrders.filter((wo) => matchesWhere(wo, args?.where));
        const counts = new Map<string, number>();
        for (const wo of filtered) {
          const k = wo.assignedTechnicianId;
          if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([assignedTechnicianId, count]) => ({
          assignedTechnicianId,
          _count: { _all: count },
        }));
      }),
    },
    technicianTimeEntry: {
      findMany: vi.fn(async (args?: any) => {
        return timeEntries.filter((te) => matchesWhere(te, args?.where));
      }),
    },
    scheduleAppointment: {
      findMany: vi.fn(async (args?: any) => {
        return scheduleAppointments.filter((sa) => matchesWhere(sa, args?.where));
      }),
    },
    workOrderHistory: {
      findMany: vi.fn(async (args?: any) => {
        return histories.filter((h) => matchesWhere(h, args?.where));
      }),
    },
  };
}

describe("Phase 1.14.5 — Technician Productivity Metrics & Reports (Predicate-Evaluating)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockAdminContext: WorkspaceAuthorizationContext = {

    user: { id: "user_admin", email: "admin@test.com" } as any,
    membership: { id: "mem_admin", role: "ADMIN" } as any,
    workspace: { id: "ws_alpha", name: "Alpha Corp", timezone: "America/New_York" } as any,
  };

  const mockDispatcherContext: WorkspaceAuthorizationContext = {
    user: { id: "user_disp", email: "dispatcher@test.com" } as any,
    membership: { id: "mem_disp", role: "DISPATCHER" } as any,
    workspace: { id: "ws_alpha", name: "Alpha Corp", timezone: "America/New_York" } as any,
  };

  const mockTechnicianContext: WorkspaceAuthorizationContext = {
    user: { id: "user_tech_1", email: "tech1@test.com" } as any,
    membership: { id: "mem_tech_1", role: "TECHNICIAN" } as any,
    workspace: { id: "ws_alpha", name: "Alpha Corp", timezone: "America/New_York" } as any,
  };

  // =========================================================================
  // 1. Metric & Report Registry Assertions & 501 Deferrals
  // =========================================================================
  describe("1. Metric & Report Registry Assertions & 501 Deferrals", () => {
    it("verifies technicians.completedWorkOrderCount definition and date anchor", () => {
      const def = getMetricDefinition("technicians.completedWorkOrderCount");
      expect(def.key).toBe("technicians.completedWorkOrderCount");
      expect(def.category).toBe("TECHNICIAN");
      expect(def.valueType).toBe("COUNT");
      expect(def.temporality).toBe("PERIOD");
      expect(def.sourceModel).toBe("WorkOrder");
      expect(def.dateAnchor).toEqual({ model: "WorkOrder", field: "completedAt" });
      expect(def.baseWhere()).toEqual({ status: "COMPLETED" });
    });

    it("verifies technicians.cancelledWorkOrderCount definition and date anchor", () => {
      const def = getMetricDefinition("technicians.cancelledWorkOrderCount");
      expect(def.key).toBe("technicians.cancelledWorkOrderCount");
      expect(def.category).toBe("TECHNICIAN");
      expect(def.valueType).toBe("COUNT");
      expect(def.dateAnchor).toEqual({ model: "WorkOrder", field: "cancelledAt" });
      expect(def.baseWhere()).toEqual({ status: "CANCELLED" });
    });

    it("verifies technicians.avgJobDurationMinutes single formula and population reconciliation", () => {
      const def = getMetricDefinition("technicians.avgJobDurationMinutes");
      expect(def.valueType).toBe("AVG_DURATION_MINUTES");
      expect(def.sourceModel).toBe("WorkOrder");
      expect(def.dateAnchor).toEqual({ model: "WorkOrder", field: "completedAt" });
      expect(def.baseWhere()).toEqual({ status: "COMPLETED" });
    });

    it("verifies technicians.reassignmentAwayCount anchors to WorkOrderHistory", () => {
      const def = getMetricDefinition("technicians.reassignmentAwayCount");
      expect(def.sourceModel).toBe("WorkOrderHistory");
      expect(def.dateAnchor).toEqual({ model: "WorkOrderHistory", field: "createdAt" });
      expect(def.baseWhere()).toEqual({
        field: "assignedTechnicianId",
        eventType: { in: ["REASSIGNED", "UNASSIGNED"] },
      });
    });

    it("verifies report registry definition for technician.productivity and technician.selfScorecard", () => {
      const prodDef = getReportDefinition("technician.productivity");
      expect(prodDef.reportKey).toBe("technician.productivity");
      expect(prodDef.category).toBe("TECHNICIAN");
      expect(prodDef.allowedDimensions).toContain("technician");
      expect(prodDef.allowedFilters).toContain("technicianId");

      const selfDef = getReportDefinition("technician.selfScorecard");
      expect(selfDef.reportKey).toBe("technician.selfScorecard");
      expect(selfDef.category).toBe("TECHNICIAN");
      expect(selfDef.selfScopedRoles).toContain("TECHNICIAN");
    });

    it("throws 501 for deferred metrics (onTimeArrivalRate, utilizationRate, firstTimeFixRate)", () => {
      expect(() => getMetricDefinition("technicians.onTimeArrivalRate")).toThrow(
        ReportMetricUnavailableError,
      );
      try {
        getMetricDefinition("technicians.onTimeArrivalRate");
      } catch (err: any) {
        expect(err.statusCode).toBe(501);
        expect(err.message).toContain("ARRIVED");
      }

      expect(() => getMetricDefinition("technicians.utilizationRate")).toThrow(
        ReportMetricUnavailableError,
      );
      try {
        getMetricDefinition("technicians.utilizationRate");
      } catch (err: any) {
        expect(err.statusCode).toBe(501);
        expect(err.message).toContain("shift calendar");
      }

      expect(() => getMetricDefinition("technicians.firstTimeFixRate")).toThrow(
        ReportMetricUnavailableError,
      );
      try {
        getMetricDefinition("technicians.firstTimeFixRate");
      } catch (err: any) {
        expect(err.statusCode).toBe(501);
        expect(err.message).toContain("firstTimeFix");
      }
    });
  });

  // =========================================================================
  // 2. In-Query Scoping & B3 Reassignment Fixture Evaluation
  // =========================================================================
  describe("2. In-Query Scoping & B3 Reassignment Fixture Evaluation", () => {
    it("proves scoping is applied in the database query (WHERE clause) rather than post-filtered", async () => {
      let capturedWorkOrderWhere: any = null;
      let capturedTimeEntryWhere: any = null;
      let capturedHistoryWhere: any = null;

      const mockDb: any = {
        employee: {
          findFirst: vi.fn().mockResolvedValue({
            technicianProfile: { id: "tech_prof_self" },
          }),
        },
        workOrder: {
          findMany: vi.fn(async (args) => {
            capturedWorkOrderWhere = args.where;
            return [];
          }),
          groupBy: vi.fn().mockResolvedValue([]),
        },
        technicianTimeEntry: {
          findMany: vi.fn(async (args) => {
            capturedTimeEntryWhere = args.where;
            return [];
          }),
        },
        workOrderHistory: {
          findMany: vi.fn(async (args) => {
            capturedHistoryWhere = args.where;
            return [];
          }),
        },
      };

      await getTechnicianProductivityReport(
        "ws_alpha",
        { preset: "THIS_MONTH" },
        mockTechnicianContext,
        "technician.selfScorecard",
        mockDb,
      );

      // Assert that technician ID scope is injected directly in the database WHERE clause
      expect(capturedWorkOrderWhere.assignedTechnicianId).toEqual({ in: ["tech_prof_self"] });
      expect(capturedWorkOrderWhere.workspaceId).toBe("ws_alpha");

      expect(capturedTimeEntryWhere.technicianProfileId).toEqual({ in: ["tech_prof_self"] });
      expect(capturedTimeEntryWhere.workspaceId).toBe("ws_alpha");

      expect(capturedHistoryWhere.oldValue).toEqual({ in: ["tech_prof_self"] });
      expect(capturedHistoryWhere.field).toBe("assignedTechnicianId");
      expect(capturedHistoryWhere.eventType).toEqual({ in: ["REASSIGNED", "UNASSIGNED"] });
      expect(capturedHistoryWhere.workspaceId).toBe("ws_alpha");
    });

    it("B3: five history rows across X->Y->Z asserts away-count 2/1/0, ASSIGNED excluded, UNASSIGNED counted, and foreign workspace invisible", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        technicianProfiles: [
          { id: "tech_X", employee: { workspaceId: "ws_alpha", displayName: "Tech X" } },
          { id: "tech_Y", employee: { workspaceId: "ws_alpha", displayName: "Tech Y" } },
          { id: "tech_Z", employee: { workspaceId: "ws_alpha", displayName: "Tech Z" } },
        ],
        workOrderHistories: [
          // Row 1: Hop 1 (X -> Y) in ws_alpha (Reassigned away from X)
          {
            id: "h_1",
            workspaceId: "ws_alpha",
            workOrderId: "wo_1",
            eventType: "REASSIGNED",
            field: "assignedTechnicianId",
            oldValue: "tech_X",
            newValue: "tech_Y",
            createdAt: new Date("2026-08-10T10:00:00Z"),
          },
          // Row 2: Hop 2 (Y -> Z) in ws_alpha (Reassigned away from Y)
          {
            id: "h_2",
            workspaceId: "ws_alpha",
            workOrderId: "wo_1",
            eventType: "REASSIGNED",
            field: "assignedTechnicianId",
            oldValue: "tech_Y",
            newValue: "tech_Z",
            createdAt: new Date("2026-08-12T14:00:00Z"),
          },
          // Row 3: Initial assignment (ASSIGNED) to X — must be EXCLUDED from away-count
          {
            id: "h_3",
            workspaceId: "ws_alpha",
            workOrderId: "wo_2",
            eventType: "ASSIGNED",
            field: "assignedTechnicianId",
            oldValue: null,
            newValue: "tech_X",
            createdAt: new Date("2026-08-05T09:00:00Z"),
          },
          // Row 4: Unassignment (UNASSIGNED) from X — must be COUNTED for X
          {
            id: "h_4",
            workspaceId: "ws_alpha",
            workOrderId: "wo_3",
            eventType: "UNASSIGNED",
            field: "assignedTechnicianId",
            oldValue: "tech_X",
            newValue: null,
            createdAt: new Date("2026-08-15T11:00:00Z"),
          },
          // Row 5: Foreign workspace reassignment from X — must be EXCLUDED by workspaceId predicate
          {
            id: "h_5",
            workspaceId: "ws_foreign",
            workOrderId: "wo_foreign",
            eventType: "REASSIGNED",
            field: "assignedTechnicianId",
            oldValue: "tech_X",
            newValue: "tech_Y",
            createdAt: new Date("2026-08-18T10:00:00Z"),
          },
        ],
      });

      const res = await getTechnicianProductivityReport(
        "ws_alpha",
        { preset: "THIS_MONTH", sortBy: "technician", sortOrder: "asc" },
        mockAdminContext,
        "technician.productivity",
        mockDb,
      );

      const rows = (res as any).items;
      const xRow = rows.find((r: any) => r.dimensions.technician.key === "tech_X");
      const yRow = rows.find((r: any) => r.dimensions.technician.key === "tech_Y");
      const zRow = rows.find((r: any) => r.dimensions.technician.key === "tech_Z");

      // tech_X: 1 REASSIGNED + 1 UNASSIGNED = 2. (ASSIGNED excluded, foreign ws_foreign row excluded).
      // tech_Y: 1 REASSIGNED = 1.
      // tech_Z: 0 away events.
      expect(xRow.values["technicians.reassignmentAwayCount"]).toBe(2);
      expect(yRow.values["technicians.reassignmentAwayCount"]).toBe(1);
      expect(zRow.values["technicians.reassignmentAwayCount"]).toBe(0);
    });
  });

  // =========================================================================
  // 3. B2 Anchor Mutation Regression Test
  // =========================================================================
  describe("3. B2 Anchor Mutation Regression Test", () => {
    it("B2: mutating a completed record (rescheduling/updating notes/advancing updatedAt) does NOT drift reporting period membership", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        technicianProfiles: [
          { id: "tech_1", employee: { workspaceId: "ws_alpha", displayName: "Tech 1" } },
        ],
        workOrders: [
          {
            id: "wo_completed_aug",
            workspaceId: "ws_alpha",
            assignedTechnicianId: "tech_1",
            status: "COMPLETED",
            startedAt: new Date("2026-08-10T09:00:00Z"),
            completedAt: new Date("2026-08-10T11:00:00Z"), // Completed Aug 10
            updatedAt: new Date("2026-09-15T15:00:00Z"),   // Touched/mutated in September
            technicianTimeEntries: [
              { durationMinutes: 120, status: "COMPLETED", startedAt: new Date("2026-08-10T09:00:00Z"), endedAt: new Date("2026-08-10T11:00:00Z") },
            ],
          },
          {
            id: "wo_completed_sept",
            workspaceId: "ws_alpha",
            assignedTechnicianId: "tech_1",
            status: "COMPLETED",
            startedAt: new Date("2026-09-01T09:00:00Z"),
            completedAt: new Date("2026-09-01T11:00:00Z"), // Completed Sept 1
            updatedAt: new Date("2026-09-01T11:00:00Z"),
            technicianTimeEntries: [{ durationMinutes: 60, status: "COMPLETED" }],
          },
        ],
      });

      // 1. Query for August 2026: only wo_completed_aug must be included
      const augRes = await getTechnicianProductivityReport(
        "ws_alpha",
        { preset: "THIS_MONTH" }, // August 2026
        mockDispatcherContext,
        "technician.productivity",
        mockDb,
      );
      const augRows = (augRes as any).items;
      expect(augRows[0].values["technicians.completedWorkOrderCount"]).toBe(1);
      expect(augRows[0].values["technicians.avgJobDurationMinutes"]).toBe(120);

      // 2. Query for September 2026 (via custom range): only wo_completed_sept must be included
      const septRes = await getTechnicianProductivityReport(
        "ws_alpha",
        { from: "2026-09-01", to: "2026-09-30" },
        mockDispatcherContext,
        "technician.productivity",
        mockDb,
      );
      const septRows = (septRes as any).items;
      expect(septRows[0].values["technicians.completedWorkOrderCount"]).toBe(1);
      expect(septRows[0].values["technicians.avgJobDurationMinutes"]).toBe(60);
    });
  });

  // =========================================================================
  // 4. Zero-Activity & Deactivated Technicians (B.3 & B.4)
  // =========================================================================
  describe("4. Zero-Activity & Deactivated Technicians (B.3 & B.4)", () => {
    it("verifies zero-activity technicians appear in results with zero counts and null rates", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        technicianProfiles: [
          { id: "tech_idle_1", employee: { workspaceId: "ws_alpha", displayName: "Idle Tech" } },
        ],
      });

      const res = await getTechnicianProductivityReport(
        "ws_alpha",
        { preset: "THIS_MONTH" },
        mockAdminContext,
        "technician.productivity",
        mockDb,
      );

      expect(res.meta.shape).toBe("ROWS");
      const rows = (res as any).items;
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual({
        dimensions: {
          technician: {
            key: "tech_idle_1",
            label: "Idle Tech",
          },
        },
        values: {
          "technicians.completedWorkOrderCount": 0,
          "technicians.cancelledWorkOrderCount": 0,
          "technicians.avgJobDurationMinutes": null, // Divide-by-zero convention: null
          "technicians.reassignmentAwayCount": 0,
          "technicians.onSiteMinutes": 0,
          "technicians.travelMinutes": 0,
          "technicians.trackedMinutes": 0,
          "technicians.onSiteShareOfTrackedTime": null, // Divide-by-zero convention: null
        },
      });
    });

    it("verifies deactivated technicians in historical periods resolve data and display names correctly", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        technicianProfiles: [
          { id: "tech_term_9", employee: { workspaceId: "ws_alpha", displayName: "Terminated Tech", status: "TERMINATED" } },
        ],
        workOrders: [
          {
            id: "wo_term_1",
            workspaceId: "ws_alpha",
            assignedTechnicianId: "tech_term_9",
            status: "COMPLETED",
            completedAt: new Date("2026-08-05T12:00:00Z"),
            technicianTimeEntries: [{ durationMinutes: 90, status: "COMPLETED" }],
          },
        ],
        technicianTimeEntries: [
          {
            id: "te_term_1",
            workspaceId: "ws_alpha",
            technicianProfileId: "tech_term_9",
            entryType: "ON_SITE",
            durationMinutes: 90,
            status: "COMPLETED",
            startedAt: new Date("2026-08-05T10:30:00Z"),
          },
        ],
      });

      const res = await getTechnicianProductivityReport(
        "ws_alpha",
        { preset: "THIS_MONTH" },
        mockDispatcherContext,
        "technician.productivity",
        mockDb,
      );

      const rows = (res as any).items;
      expect(rows.length).toBe(1);
      expect(rows[0].dimensions.technician.label).toBe("Terminated Tech");
      expect(rows[0].values["technicians.completedWorkOrderCount"]).toBe(1);
      expect(rows[0].values["technicians.avgJobDurationMinutes"]).toBe(90);
    });

    it("verifies selfScorecard returns SCALARS shape for technician principal", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        technicianProfiles: [
          { id: "tech_self_1", employee: { workspaceId: "ws_alpha", workspaceMemberId: "mem_tech_1", displayName: "Self Tech" } },
        ],
        employees: [
          {
            id: "emp_1",
            workspaceId: "ws_alpha",
            workspaceMemberId: "mem_tech_1",
            technicianProfile: { id: "tech_self_1" },
          },
        ],
        workOrders: [
          {
            id: "wo_self_1",
            workspaceId: "ws_alpha",
            assignedTechnicianId: "tech_self_1",
            status: "COMPLETED",
            completedAt: new Date("2026-08-08T10:00:00Z"),
            technicianTimeEntries: [{ durationMinutes: 45, status: "COMPLETED" }],
          },
        ],
        technicianTimeEntries: [
          {
            id: "te_1",
            workspaceId: "ws_alpha",
            technicianProfileId: "tech_self_1",
            entryType: "ON_SITE",
            durationMinutes: 45,
            status: "COMPLETED",
            startedAt: new Date("2026-08-08T09:15:00Z"),
          },
          {
            id: "te_2",
            workspaceId: "ws_alpha",
            technicianProfileId: "tech_self_1",
            entryType: "TRAVEL",
            durationMinutes: 15,
            status: "COMPLETED",
            startedAt: new Date("2026-08-08T09:00:00Z"),
          },
        ],
      });

      const res = await getTechnicianProductivityReport(
        "ws_alpha",
        { preset: "THIS_MONTH" },
        mockTechnicianContext,
        "technician.selfScorecard",
        mockDb,
      );

      expect(res.meta.shape).toBe("SCALARS");
      expect((res as any).values).toEqual({
        "technicians.completedWorkOrderCount": 1,
        "technicians.cancelledWorkOrderCount": 0,
        "technicians.avgJobDurationMinutes": 45,
        "technicians.reassignmentAwayCount": 0,
        "technicians.onSiteMinutes": 45,
        "technicians.travelMinutes": 15,
        "technicians.trackedMinutes": 60,
        "technicians.onSiteShareOfTrackedTime": 75,
      });
    });

    it("verifies deterministic tie-breaking on technician ID when metric values are identical", async () => {
      const mockDb: any = createPredicateEvaluatingDb({
        technicianProfiles: [
          { id: "tech_zulu", employee: { workspaceId: "ws_alpha", displayName: "Zulu" } },
          { id: "tech_alpha", employee: { workspaceId: "ws_alpha", displayName: "Alpha" } },
          { id: "tech_bravo", employee: { workspaceId: "ws_alpha", displayName: "Bravo" } },
        ],
        workOrders: [
          { id: "w1", workspaceId: "ws_alpha", assignedTechnicianId: "tech_zulu", status: "COMPLETED", completedAt: new Date("2026-08-01Z") },
          { id: "w2", workspaceId: "ws_alpha", assignedTechnicianId: "tech_alpha", status: "COMPLETED", completedAt: new Date("2026-08-01Z") },
          { id: "w3", workspaceId: "ws_alpha", assignedTechnicianId: "tech_bravo", status: "COMPLETED", completedAt: new Date("2026-08-01Z") },
        ],
      });

      const res = await getTechnicianProductivityReport(
        "ws_alpha",
        { preset: "THIS_MONTH", sortBy: "technicians.completedWorkOrderCount", sortOrder: "desc" },
        mockAdminContext,
        "technician.productivity",
        mockDb,
      );

      const rows = (res as any).items;
      expect(rows.map((r: any) => r.dimensions.technician.key)).toEqual([
        "tech_alpha",
        "tech_bravo",
        "tech_zulu",
      ]);
    });

    it("confirms zero write methods (create, update, delete, upsert, $transaction) are invoked", async () => {
      const createSpy = vi.fn();
      const updateSpy = vi.fn();
      const deleteSpy = vi.fn();
      const upsertSpy = vi.fn();

      const mockDb: any = {
        technicianProfile: { findMany: vi.fn().mockResolvedValue([]) },
        workOrder: {
          findMany: vi.fn().mockResolvedValue([]),
          groupBy: vi.fn().mockResolvedValue([]),
          create: createSpy,
          update: updateSpy,
          delete: deleteSpy,
          upsert: upsertSpy,
        },
        technicianTimeEntry: {
          findMany: vi.fn().mockResolvedValue([]),
          create: createSpy,
          update: updateSpy,
        },
        workOrderHistory: { findMany: vi.fn().mockResolvedValue([]) },
      };

      await getTechnicianProductivityReport(
        "ws_alpha",
        { preset: "THIS_MONTH" },
        mockAdminContext,
        "technician.productivity",
        mockDb,
      );

      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(upsertSpy).not.toHaveBeenCalled();
    });
  });
});
