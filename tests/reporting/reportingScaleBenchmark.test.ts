import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
  requireWorkspaceAuthorization: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workOrder: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
  },
}));

import { Prisma } from "@/generated/prisma/client";
import { composeReport } from "@/lib/services/reporting/reportEngine";
import { serializeReportToCsv } from "@/lib/services/reporting/csvSerializer";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import type {
  ReportRowsReadModel,
  UnscopedReportDb,
} from "@/lib/services/reporting/reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import "@/lib/services/reporting/index";

describe("Phase 1.14.10 — High-Scale Benchmarks & Memory Profile", () => {
  const mockWorkspaceId = "ws_benchmark_scale";

  const mockAuthContext: WorkspaceAuthorizationContext = {
    user: {
      id: "usr_admin_1",
      name: "Admin User",
      email: "admin@aforden.test",
      status: "ACTIVE",
      emailVerified: new Date(),
    },
    workspace: {
      id: mockWorkspaceId,
      name: "Scale Benchmark Corp",
      slug: "benchmark-corp",
      logoUrl: null,
      timezone: "UTC",
    },
    membership: {
      id: "mem_mock_1",
      role: "ADMIN",
      status: "ACTIVE",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (requireWorkspaceAuthorization as any).mockResolvedValue(mockAuthContext);
  });

  // =========================================================================
  // Benchmark 1: inventory.partsConsumption at Stated Ceiling (25,000 Parts)
  // =========================================================================
  it("benchmarks inventory.partsConsumption at 25,000 parts ceiling", async () => {
    const PART_COUNT = 25_000;
    const MOVEMENT_COUNT = 10_000;
    const WORK_ORDER_PART_COUNT = 15_000;

    // Seed 25,000 parts
    const mockParts = Array.from({ length: PART_COUNT }, (_, i) => ({
      id: `part_${String(i + 1).padStart(5, "0")}`,
      name: `Replacement Component ${i + 1}`,
      partNumber: `PN-${String(i + 1).padStart(5, "0")}`,
      cost: new Prisma.Decimal("45.50"),
      unitOfMeasure: "EA",
      trackInventory: true,
      minimumStockLevel: 5,
    }));

    // Seed 10,000 stock movements
    const mockMovements = Array.from({ length: MOVEMENT_COUNT }, (_, i) => ({
      partId: `part_${String((i % PART_COUNT) + 1).padStart(5, "0")}`,
      movementType: i % 2 === 0 ? "RECEIPT" : "CONSUMPTION",
      quantity: new Prisma.Decimal(String((i % 10) + 1)),
      unitCost: new Prisma.Decimal("45.50"),
      createdAt: new Date("2026-08-10T10:00:00Z"),
    }));

    // Seed 15,000 work order consumed parts
    const mockConsumed = Array.from({ length: WORK_ORDER_PART_COUNT }, (_, i) => ({
      partId: `part_${String((i % PART_COUNT) + 1).padStart(5, "0")}`,
      locationId: `loc_${(i % 5) + 1}`,
      quantity: new Prisma.Decimal("2"),
      unitCostAtTimeOfUse: new Prisma.Decimal("45.50"),
      createdAt: new Date("2026-08-15T12:00:00Z"),
    }));

    let partQueryCount = 0;
    let movementQueryCount = 0;
    let consumedQueryCount = 0;

    const mockDb: UnscopedReportDb = {
      part: {
        findMany: vi.fn().mockImplementation(async () => {
          partQueryCount++;
          return mockParts;
        }),
      } as any,
      stockMovement: {
        findMany: vi.fn().mockImplementation(async () => {
          movementQueryCount++;
          return mockMovements;
        }),
      } as any,
      workOrderPart: {
        findMany: vi.fn().mockImplementation(async () => {
          consumedQueryCount++;
          return mockConsumed;
        }),
      } as any,
    };

    const memBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    // Execute Page 1 with limit 20
    const resPage1 = (await composeReport(
      "inventory.partsConsumption",
      mockWorkspaceId,
      {
        preset: "THIS_MONTH",
        dimensions: ["part"],
        page: 1,
        limit: 20,
      },
      mockAuthContext,
      mockDb,
    )) as ReportRowsReadModel;

    const t1 = performance.now();
    const memAfter = process.memoryUsage().heapUsed;

    const executionMs = t1 - t0;
    const heapDeltaMb = (memAfter - memBefore) / (1024 * 1024);

    // Verify response structure and bounds
    expect(resPage1.meta.shape).toBe("ROWS");
    expect(resPage1.meta.truncated).toBe(true);
    expect(resPage1.meta.totalUncappedCount).toBe(PART_COUNT);
    expect(resPage1.items).toHaveLength(20);
    expect(resPage1.page).toBe(1);
    expect(resPage1.limit).toBe(20);
    expect(resPage1.totalPages).toBe(Math.ceil(PART_COUNT / 20));

    // Verify CSV serialization performance on paginated slice
    const csvStart = performance.now();
    const csv = serializeReportToCsv(resPage1);
    const csvEnd = performance.now();
    const csvMs = csvEnd - csvStart;

    // ROWS CSV: 1 header + 20 data rows = 21 lines (the trailing \r\n makes split return 21 elements)
    expect(csv.split("\r\n").filter((l) => l.length > 0)).toHaveLength(21); // Header + 20 rows

    console.log(
      `[Benchmark: inventory.partsConsumption @ 25,000 parts] Execution: ${executionMs.toFixed(2)}ms | CSV: ${csvMs.toFixed(2)}ms | Heap Delta: ${heapDeltaMb.toFixed(2)}MB | DB Queries: ${partQueryCount + movementQueryCount + consumedQueryCount}`,
    );
  });

  // =========================================================================
  // Benchmark 2: customer.activitySummary at Stated Ceiling (15,000 Customers)
  // =========================================================================
  it("benchmarks customer.activitySummary at 15,000 customers ceiling", async () => {
    const CUSTOMER_COUNT = 15_000;
    const WO_COUNT = 25_000;
    const INVOICE_COUNT = 20_000;

    const mockCustomers = Array.from({ length: CUSTOMER_COUNT }, (_, i) => ({
      id: `cust_${String(i + 1).padStart(5, "0")}`,
      name: `Customer Account ${i + 1}`,
      customerNumber: `CUST-${String(i + 1).padStart(5, "0")}`,
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }));

    const mockWorkOrders = Array.from({ length: WO_COUNT }, (_, i) => ({
      id: `wo_${i + 1}`,
      customerId: `cust_${String((i % CUSTOMER_COUNT) + 1).padStart(5, "0")}`,
      status: "COMPLETED",
      completedAt: new Date("2026-08-10T10:00:00Z"),
    }));

    const mockInvoices = Array.from({ length: INVOICE_COUNT }, (_, i) => ({
      id: `inv_${i + 1}`,
      customerId: `cust_${String((i % CUSTOMER_COUNT) + 1).padStart(5, "0")}`,
      status: "PAID",
      total: new Prisma.Decimal("250.00"),
    }));

    let customerQueries = 0;
    let woQueries = 0;
    let invoiceQueries = 0;

    const mockDb: UnscopedReportDb = {
      customer: {
        findMany: vi.fn().mockImplementation(async () => {
          customerQueries++;
          return mockCustomers;
        }),
      } as any,
      workOrder: {
        findMany: vi.fn().mockImplementation(async () => {
          woQueries++;
          return mockWorkOrders;
        }),
      } as any,
      invoice: {
        findMany: vi.fn().mockImplementation(async () => {
          invoiceQueries++;
          return mockInvoices;
        }),
      } as any,
    };

    const t0 = performance.now();
    const resPage1 = (await composeReport(
      "customer.activitySummary",
      mockWorkspaceId,
      {
        preset: "THIS_MONTH",
        dimensions: ["customer"],
        page: 1,
        limit: 50,
      },
      mockAuthContext,
      mockDb,
    )) as ReportRowsReadModel;
    const t1 = performance.now();

    const executionMs = t1 - t0;

    expect(resPage1.meta.truncated).toBe(true);
    expect(resPage1.meta.totalUncappedCount).toBe(CUSTOMER_COUNT);
    expect(resPage1.items).toHaveLength(50);
    expect(resPage1.totalPages).toBe(Math.ceil(CUSTOMER_COUNT / 50));

    console.log(
      `[Benchmark: customer.activitySummary @ 15,000 customers] Execution: ${executionMs.toFixed(2)}ms | DB Queries: ${customerQueries + woQueries + invoiceQueries}`,
    );
  });  // =========================================================================
  // Benchmark 3: technician.productivity at 1,000 Technicians & 20,000 Time Entries (ROWS Mode)
  // =========================================================================
  it("benchmarks technician.productivity at 1,000 technicians and 20,000 time entries in ROWS mode", async () => {
    const TECH_COUNT = 1_000;
    const WO_COMPLETED_COUNT = 10_000;
    const ENTRY_COUNT = 20_000;
    const REASSIGNMENT_COUNT = 1_000;

    const mockTechProfiles = Array.from({ length: TECH_COUNT }, (_, i) => ({
      id: `tech_${String(i + 1).padStart(4, "0")}`,
      employee: {
        workspaceId: mockWorkspaceId,
        firstName: `TechFirstName${i + 1}`,
        lastName: `TechLastName${i + 1}`,
        displayName: `Tech ${i + 1}`,
      },
    }));

    const mockCompletedWOs = Array.from({ length: WO_COMPLETED_COUNT }, (_, i) => ({
      id: `wo_comp_${i + 1}`,
      assignedTechnicianId: `tech_${String((i % TECH_COUNT) + 1).padStart(4, "0")}`,
      startedAt: new Date("2026-08-10T08:00:00Z"),
      completedAt: new Date("2026-08-10T10:00:00Z"),
      technicianTimeEntries: [
        {
          durationMinutes: 120,
          startedAt: new Date("2026-08-10T08:00:00Z"),
          endedAt: new Date("2026-08-10T10:00:00Z"),
        },
      ],
    }));

    const mockTimeEntries = Array.from({ length: ENTRY_COUNT }, (_, i) => ({
      id: `te_${i + 1}`,
      technicianProfileId: `tech_${String((i % TECH_COUNT) + 1).padStart(4, "0")}`,
      entryType: i % 2 === 0 ? "ON_SITE" : "TRAVEL",
      startTime: new Date("2026-08-10T08:00:00Z"),
      endTime: new Date("2026-08-10T10:00:00Z"),
      startedAt: new Date("2026-08-10T08:00:00Z"),
      endedAt: new Date("2026-08-10T10:00:00Z"),
      durationMinutes: 120,
      status: "COMPLETED",
    }));

    const mockReassignments = Array.from({ length: REASSIGNMENT_COUNT }, (_, i) => ({
      oldValue: `tech_${String((i % TECH_COUNT) + 1).padStart(4, "0")}`,
      newValue: `tech_${String(((i + 1) % TECH_COUNT) + 1).padStart(4, "0")}`,
    }));

    let woQueries = 0;
    let timeEntryQueries = 0;
    let historyQueries = 0;
    let profileQueries = 0;

    const mockDb: UnscopedReportDb = {
      technicianProfile: {
        findMany: vi.fn().mockImplementation(async (args?: any) => {
          profileQueries++;
          if (args?.where?.id?.in) {
            const inSet = new Set(args.where.id.in);
            return mockTechProfiles.filter((p) => inSet.has(p.id));
          }
          return mockTechProfiles;
        }),
      } as any,
      technicianTimeEntry: {
        findMany: vi.fn().mockImplementation(async () => {
          timeEntryQueries++;
          return mockTimeEntries;
        }),
      } as any,
      workOrder: {
        findMany: vi.fn().mockImplementation(async () => {
          woQueries++;
          return mockCompletedWOs;
        }),
        groupBy: vi.fn().mockImplementation(async () => {
          return Array.from({ length: TECH_COUNT }, (_, i) => ({
            assignedTechnicianId: `tech_${String(i + 1).padStart(4, "0")}`,
            _count: { _all: 2 },
          }));
        }),
      } as any,
      workOrderHistory: {
        findMany: vi.fn().mockImplementation(async () => {
          historyQueries++;
          return mockReassignments;
        }),
      } as any,
    };

    const memBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    // ROWS mode — requesting grouped by technician with page 1, limit 20
    const resRows = (await composeReport(
      "technician.productivity",
      mockWorkspaceId,
      {
        preset: "THIS_MONTH",
        dimensions: ["technician"],
        page: 1,
        limit: 20,
      },
      mockAuthContext,
      mockDb,
    )) as ReportRowsReadModel;

    const t1 = performance.now();
    const memAfter = process.memoryUsage().heapUsed;

    const executionMs = t1 - t0;
    const heapDeltaMb = (memAfter - memBefore) / (1024 * 1024);

    // ROWS shape confirms dimension grouping path
    expect(resRows.meta.shape).toBe("ROWS");
    expect(resRows.meta.truncated).toBe(false);
    expect(resRows.meta.totalUncappedCount).toBe(TECH_COUNT);
    expect(resRows.items).toHaveLength(20);
    expect(resRows.page).toBe(1);
    expect(resRows.limit).toBe(20);
    expect(resRows.totalPages).toBe(Math.ceil(TECH_COUNT / 20));

    // Verify CSV serialization performance on paginated slice
    const csvStart = performance.now();
    const csv = serializeReportToCsv(resRows);
    const csvEnd = performance.now();
    const csvMs = csvEnd - csvStart;

    expect(csv.split("\r\n").filter((l) => l.length > 0)).toHaveLength(21); // Header + 20 rows

    console.log(
      `[Benchmark: technician.productivity @ 1,000 techs / 20,000 time entries (ROWS mode)] Execution: ${executionMs.toFixed(2)}ms | CSV: ${csvMs.toFixed(2)}ms | Heap Delta: ${heapDeltaMb.toFixed(2)}MB | DB Queries: ${woQueries + timeEntryQueries + historyQueries + profileQueries}`,
    );
  });
});
