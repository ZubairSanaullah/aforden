import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { composeReport } from "@/lib/services/reporting/reportEngine";
import {
  serializeReportToCsv,
  escapeCsvCell,
  formatMetricCsvValue,
} from "@/lib/services/reporting/csvSerializer";
import { GET as reportSlugRoute } from "@/app/api/reports/[...reportSlug]/route";
import { GET as reportCatalogRoute } from "@/app/api/reports/route";
import { REPORT_KEYS } from "@/lib/services/reporting/reporting.schemas";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import type {
  ReportResponse,
  ReportRowsReadModel,
  ReportScalarsReadModel,
  ReportSeriesReadModel,
  ScopedReportDb,
  UnscopedReportDb,
} from "@/lib/services/reporting/reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import "@/lib/services/reporting/index";
import { UnauthorizedError } from "@/lib/services/authorization/authorizationErrors";

// Mock prisma for route tests
vi.mock("@/lib/prisma", () => ({
  prisma: {
    workOrder: {
      count: vi.fn().mockResolvedValue(12),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    user: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
  },
}));

// Mock auth and workspace authorization modules
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
  requireWorkspaceAuthorization: vi.fn(),
}));

import { auth } from "@/auth";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { prisma } from "@/lib/prisma";

const mockWorkspaceId = "ws_test_phase_1_14_9";

const createMockAuthContext = (
  role: "OWNER" | "ADMIN" | "DISPATCHER" | "TECHNICIAN" = "ADMIN",
): WorkspaceAuthorizationContext => ({
  user: {
    id: "usr_mock_1",
    name: "Admin User",
    email: "admin@aforden.test",
    status: "ACTIVE",
    emailVerified: new Date(),
  },
  workspace: {
    id: mockWorkspaceId,
    name: "Test Workspace",
    slug: "test-workspace",
    logoUrl: null,
    timezone: "UTC",
  },
  membership: {
    id: "mem_mock_1",
    role,
    status: "ACTIVE",
  },
});

describe("Phase 1.14.9 — REST API Routes, Real Pagination & CSV Export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireWorkspaceAuthorization as any).mockResolvedValue(createMockAuthContext("ADMIN"));
  });

  // =========================================================================
  // 1. Real Pagination in composeReport() Stage 9/10
  // =========================================================================
  describe("1. Real Pagination Slicing & Metadata", () => {
    it("slices rows correctly according to page and limit with total and totalPages", async () => {
      // Mock db that returns 25 distinct customer quotes for quote conversion report
      const mockQuotes = Array.from({ length: 25 }, (_, i) => ({
        id: `q_${i + 1}`,
        customerId: `cust_${String(i + 1).padStart(2, "0")}`,
        status: "APPROVED",
        total: new Prisma.Decimal("100.00"),
        createdAt: new Date("2026-08-15T10:00:00Z"),
      }));

      const mockDb: UnscopedReportDb = {
        quote: {
          findMany: vi.fn().mockResolvedValue(mockQuotes),
        } as any,
        customer: {
          findMany: vi.fn().mockResolvedValue(
            mockQuotes.map((q) => ({
              id: q.customerId,
              name: `Customer ${q.customerId}`,
            })),
          ),
        } as any,
      };

      const authContext = createMockAuthContext("ADMIN");

      // Page 1 with limit 10
      const resPage1 = (await composeReport(
        "financial.quoteConversion",
        mockWorkspaceId,
        {
          preset: "THIS_MONTH",
          dimensions: ["customer"],
          page: 1,
          limit: 10,
        },
        authContext,
        mockDb,
      )) as ReportRowsReadModel;

      expect(resPage1.meta.shape).toBe("ROWS");
      expect(resPage1.items).toHaveLength(10);
      expect(resPage1.total).toBe(25);
      expect(resPage1.page).toBe(1);
      expect(resPage1.limit).toBe(10);
      expect(resPage1.totalPages).toBe(3);
      expect(resPage1.meta.truncated).toBe(false);
      expect(resPage1.meta.totalUncappedCount).toBe(25);
      expect(resPage1.meta.pagination).toEqual({
        page: 1,
        limit: 10,
        totalPages: 3,
        totalRows: 25,
      });

      // Page 2 with limit 10
      const resPage2 = (await composeReport(
        "financial.quoteConversion",
        mockWorkspaceId,
        {
          preset: "THIS_MONTH",
          dimensions: ["customer"],
          page: 2,
          limit: 10,
        },
        authContext,
        mockDb,
      )) as ReportRowsReadModel;

      expect(resPage2.items).toHaveLength(10);
      expect(resPage2.page).toBe(2);
      expect(resPage2.total).toBe(25);

      // Page 3 with limit 10 (should have remaining 5 items)
      const resPage3 = (await composeReport(
        "financial.quoteConversion",
        mockWorkspaceId,
        {
          preset: "THIS_MONTH",
          dimensions: ["customer"],
          page: 3,
          limit: 10,
        },
        authContext,
        mockDb,
      )) as ReportRowsReadModel;

      expect(resPage3.items).toHaveLength(5);
      expect(resPage3.page).toBe(3);

      // Page 4 out-of-bounds (should have 0 items)
      const resPage4 = (await composeReport(
        "financial.quoteConversion",
        mockWorkspaceId,
        {
          preset: "THIS_MONTH",
          dimensions: ["customer"],
          page: 4,
          limit: 10,
        },
        authContext,
        mockDb,
      )) as ReportRowsReadModel;

      expect(resPage4.items).toHaveLength(0);
      expect(resPage4.page).toBe(4);
      expect(resPage4.totalPages).toBe(3);
    });

    it("preserves deterministic sort order and tie-break across pagination slices", async () => {
      const mockQuotes = [
        {
          id: "q_1",
          customerId: "cust_b",
          status: "APPROVED",
          total: new Prisma.Decimal("500.00"),
          createdAt: new Date("2026-08-15T10:00:00Z"),
        },
        {
          id: "q_2",
          customerId: "cust_a",
          status: "APPROVED",
          total: new Prisma.Decimal("500.00"), // Identical total -> tie break on groupKey "cust_a" vs "cust_b"
          createdAt: new Date("2026-08-15T10:00:00Z"),
        },
        {
          id: "q_3",
          customerId: "cust_c",
          status: "APPROVED",
          total: new Prisma.Decimal("1000.00"),
          createdAt: new Date("2026-08-15T10:00:00Z"),
        },
      ];

      const mockDb: UnscopedReportDb = {
        quote: {
          findMany: vi.fn().mockResolvedValue(mockQuotes),
        } as any,
        customer: {
          findMany: vi.fn().mockResolvedValue([
            { id: "cust_a", name: "Customer A" },
            { id: "cust_b", name: "Customer B" },
            { id: "cust_c", name: "Customer C" },
          ]),
        } as any,
      };

      const authContext = createMockAuthContext("ADMIN");

      // Sorted by default (quotes.pipelineTotal or quotes.approvedTotal desc)
      const resPage1 = (await composeReport(
        "financial.quoteConversion",
        mockWorkspaceId,
        {
          preset: "THIS_MONTH",
          dimensions: ["customer"],
          sortBy: "quotes.approvedTotal",
          sortOrder: "desc",
          page: 1,
          limit: 2,
        },
        authContext,
        mockDb,
      )) as ReportRowsReadModel;

      expect(resPage1.items).toHaveLength(2);
      expect(resPage1.items[0].dimensions.customer.key).toBe("cust_c"); // 1000.00
      expect(resPage1.items[1].dimensions.customer.key).toBe("cust_a"); // 500.00 (cust_a before cust_b)

      const resPage2 = (await composeReport(
        "financial.quoteConversion",
        mockWorkspaceId,
        {
          preset: "THIS_MONTH",
          dimensions: ["customer"],
          sortBy: "quotes.approvedTotal",
          sortOrder: "desc",
          page: 2,
          limit: 2,
        },
        authContext,
        mockDb,
      )) as ReportRowsReadModel;

      expect(resPage2.items).toHaveLength(1);
      expect(resPage2.items[0].dimensions.customer.key).toBe("cust_b"); // 500.00
    });

    it("rejects invalid page and limit bounds (page=0, negative page, limit=0, limit>1000) with ReportParameterValidationError", async () => {
      const authContext = createMockAuthContext("ADMIN");

      // page = 0
      await expect(
        composeReport("operational.workOrderVolume", mockWorkspaceId, { page: 0 }, authContext),
      ).rejects.toThrow(/Page must be an integer >= 1/);

      // page = -5
      await expect(
        composeReport("operational.workOrderVolume", mockWorkspaceId, { page: -5 }, authContext),
      ).rejects.toThrow(/Page must be an integer >= 1/);

      // limit = 0
      await expect(
        composeReport("operational.workOrderVolume", mockWorkspaceId, { limit: 0 }, authContext),
      ).rejects.toThrow(/Limit must be an integer >= 1/);

      // limit = 1001
      await expect(
        composeReport("operational.workOrderVolume", mockWorkspaceId, { limit: 1001 }, authContext),
      ).rejects.toThrow(/Limit cannot exceed 1000/);
    });

    it("paginates operational.workOrderThroughput and scheduling.dispatchPerformance uniformly when cardinality exceeds MAX_GROUP_CARDINALITY", async () => {
      // 1,005 distinct customers in throughput report
      const mockGroups = Array.from({ length: 1005 }, (_, i) => ({
        customerId: `cust_${String(i + 1).padStart(4, "0")}`,
        _count: { _all: 5 },
      }));

      const mockDb: UnscopedReportDb = {
        workOrder: {
          groupBy: vi.fn().mockResolvedValue(mockGroups),
          findMany: vi.fn().mockResolvedValue([]),
        } as any,
        customer: {
          findMany: vi.fn().mockResolvedValue(
            mockGroups.map((g) => ({ id: g.customerId, name: `Customer ${g.customerId}` })),
          ),
        } as any,
      };

      const authContext = createMockAuthContext("ADMIN");

      // Request page 101 with limit 10 (items 1000 to 1005 -> 5 items)
      const resPage101 = (await composeReport(
        "operational.workOrderThroughput",
        mockWorkspaceId,
        {
          preset: "THIS_MONTH",
          dimensions: ["customer"],
          page: 101,
          limit: 10,
        },
        authContext,
        mockDb,
      )) as ReportRowsReadModel;

      expect(resPage101.meta.shape).toBe("ROWS");
      expect(resPage101.meta.truncated).toBe(true);
      expect(resPage101.meta.totalUncappedCount).toBe(1005);
      expect(resPage101.items).toHaveLength(5);
      expect(resPage101.page).toBe(101);
      expect(resPage101.limit).toBe(10);
      expect(resPage101.totalPages).toBe(101);
      expect(resPage101.total).toBe(1005);
    });
  });

  // =========================================================================
  // 2. RFC 4180 CSV Serialization Engine
  // =========================================================================
  describe("2. CSV Serialization Engine", () => {
    it("escapes cells containing commas, quotes, and newlines according to RFC 4180", () => {
      expect(escapeCsvCell("Standard Text")).toBe("Standard Text");
      expect(escapeCsvCell("Acme, Inc.")).toBe('"Acme, Inc."');
      expect(escapeCsvCell('He said "Hello"')).toBe('"He said ""Hello"""');
      expect(escapeCsvCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
      expect(escapeCsvCell(null)).toBe("");
      expect(escapeCsvCell(undefined)).toBe("");
    });

    it("formats currency metrics preserving exact Decimal .toFixed(2) precision without float drift", () => {
      expect(formatMetricCsvValue(new Prisma.Decimal("1250.50"), "SUM_MONEY")).toBe("1250.50");
      expect(formatMetricCsvValue(new Prisma.Decimal("1250.5"), "SUM_MONEY")).toBe("1250.50");
      expect(formatMetricCsvValue("1250.50", "SUM_MONEY")).toBe("1250.50");
      expect(formatMetricCsvValue("10.1", "SUM_MONEY")).toBe("10.10");
      expect(formatMetricCsvValue(null, "SUM_MONEY")).toBe("");
    });

    it("serializes SCALARS report shape into 2-column key-value CSV with CRLF line endings", () => {
      const scalarReport: ReportScalarsReadModel = {
        meta: {
          reportKey: "operational.workOrderVolume",
          title: "Work Order Volume",
          generatedAt: "2026-08-27T10:00:00Z",
          timezone: "UTC",
          shape: "SCALARS",
          scope: "WORKSPACE",
          range: {
            startUtc: "2026-08-01T00:00:00Z",
            endUtc: "2026-09-01T00:00:00Z",
            startLocalDate: "2026-08-01",
            endLocalDate: "2026-08-31",
            preset: "THIS_MONTH",
            granularity: "DAY",
          },
          asOfUtc: null,
          metrics: [
            {
              key: "workOrders.createdCount",
              label: "Work Orders Created",
              valueType: "COUNT",
              temporality: "PERIOD",
            },
            {
              key: "workOrders.completedCount",
              label: "Work Orders Completed",
              valueType: "COUNT",
              temporality: "PERIOD",
            },
            {
              key: "workOrders.completionRate",
              label: "Completion Rate",
              valueType: "RATE_PERCENT",
              temporality: "PERIOD",
            },
          ],
          dimensions: [],
          appliedFilters: [],
          sort: { key: "workOrders.createdCount", order: "desc" },
          sortedInMemory: true,
          truncated: false,
        },
        values: {
          "workOrders.createdCount": 50,
          "workOrders.completedCount": 45,
          "workOrders.completionRate": 90.0,
        },
      };

      const csv = serializeReportToCsv(scalarReport);
      const lines = csv.split("\r\n");

      expect(lines[0]).toBe("Metric,Value");
      expect(lines[1]).toBe("Work Orders Created,50");
      expect(lines[2]).toBe("Work Orders Completed,45");
      expect(lines[3]).toBe("Completion Rate,90");
    });

    it("serializes divide-by-zero null metrics as empty cells in CSV", () => {
      const scalarReportWithNull: ReportScalarsReadModel = {
        meta: {
          reportKey: "operational.workOrderVolume",
          title: "Work Order Volume",
          generatedAt: "2026-08-27T10:00:00Z",
          timezone: "UTC",
          shape: "SCALARS",
          scope: "WORKSPACE",
          range: null,
          asOfUtc: null,
          metrics: [
            {
              key: "workOrders.createdCount",
              label: "Work Orders Created",
              valueType: "COUNT",
              temporality: "PERIOD",
            },
            {
              key: "workOrders.completionRate",
              label: "Completion Rate",
              valueType: "RATE_PERCENT",
              temporality: "PERIOD",
            },
          ],
          dimensions: [],
          appliedFilters: [],
          sort: { key: "workOrders.createdCount", order: "desc" },
          sortedInMemory: true,
          truncated: false,
        },
        values: {
          "workOrders.createdCount": 0,
          "workOrders.completionRate": null, // Divide-by-zero
        },
      };

      const csv = serializeReportToCsv(scalarReportWithNull);
      const lines = csv.split("\r\n");

      expect(lines[1]).toBe("Work Orders Created,0");
      expect(lines[2]).toBe("Completion Rate,"); // Empty string cell
    });

    it("serializes ROWS report shape with hydrated dimension labels and Decimal currency formatting", () => {
      const rowsReport: ReportRowsReadModel = {
        meta: {
          reportKey: "financial.revenueSummary",
          title: "Revenue Summary",
          generatedAt: "2026-08-27T10:00:00Z",
          timezone: "UTC",
          shape: "ROWS",
          scope: "WORKSPACE",
          range: null,
          asOfUtc: null,
          metrics: [
            {
              key: "invoices.invoicedRevenue",
              label: "Invoiced Revenue",
              valueType: "SUM_MONEY",
              temporality: "PERIOD",
            },
            {
              key: "invoices.issuedCount",
              label: "Issued Count",
              valueType: "COUNT",
              temporality: "PERIOD",
            },
          ],
          dimensions: [{ key: "customer", label: "Customer" }],
          appliedFilters: [],
          sort: { key: "invoices.invoicedRevenue", order: "desc" },
          sortedInMemory: true,
          truncated: false,
        },
        items: [
          {
            dimensions: {
              customer: { key: "cust_1", label: "Acme, Inc." },
            },
            values: {
              "invoices.invoicedRevenue": "12500.00",
              "invoices.issuedCount": 5,
            },
          },
          {
            dimensions: {
              customer: { key: "cust_2", label: "Beta Corp" },
            },
            values: {
              "invoices.invoicedRevenue": "450.25",
              "invoices.issuedCount": 1,
            },
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      };

      const csv = serializeReportToCsv(rowsReport);
      const lines = csv.split("\r\n");

      expect(lines[0]).toBe("Customer,Invoiced Revenue,Issued Count");
      expect(lines[1]).toBe('"Acme, Inc.",12500.00,5');
      expect(lines[2]).toBe("Beta Corp,450.25,1");
    });
  });

  // =========================================================================
  // 3. REST API Routes (/api/reports/[...reportSlug] and /api/reports)
  // =========================================================================
  describe("3. REST API Route Layer & RBAC Enforcement", () => {
    it("GET /api/reports/[...reportSlug] returns 200 with JSON report payload for valid request", async () => {
      // Mock session auth
      (auth as any).mockResolvedValue({
        user: { id: "usr_mock_1" },
      });

      const mockDb: UnscopedReportDb = {
        workOrder: {
          count: vi.fn().mockResolvedValue(12),
        } as any,
      };

      const req = new Request(
        "http://localhost:3000/api/reports/operational/work-order-volume?preset=THIS_MONTH",
        {
          headers: {
            "x-workspace-id": mockWorkspaceId,
          },
        },
      );

      const response = await reportSlugRoute(req, {
        params: { reportSlug: ["operational", "work-order-volume"] },
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.meta.reportKey).toBe("operational.workOrderVolume");
      expect(json.data.values["workOrders.createdCount"]).toBe(12);
    });

    it("GET /api/reports/[...reportSlug] returns 200 with CSV content when format=csv is requested", async () => {
      (auth as any).mockResolvedValue({
        user: { id: "usr_mock_1" },
      });

      const req = new Request(
        "http://localhost:3000/api/reports/operational/work-order-volume?preset=THIS_MONTH&format=csv",
        {
          headers: {
            "x-workspace-id": mockWorkspaceId,
          },
        },
      );

      const response = await reportSlugRoute(req, {
        params: { reportSlug: ["operational", "work-order-volume"] },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv");
      expect(response.headers.get("content-disposition")).toContain(
        'attachment; filename="operational-workOrderVolume.csv"',
      );

      const text = await response.text();
      expect(text).toContain("Metric,Value");
      expect(text).toContain("workOrders.createdCount");
    });

    it("GET /api/reports/[...reportSlug] returns 400 MISSING_WORKSPACE when tenant header is missing", async () => {
      const req = new Request(
        "http://localhost:3000/api/reports/operational/work-order-volume",
      );

      const response = await reportSlugRoute(req, {
        params: { reportSlug: ["operational", "work-order-volume"] },
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error.code).toBe("MISSING_WORKSPACE");
    });

    it("GET /api/reports/[...reportSlug] returns 401 UNAUTHORIZED when session is missing", async () => {
      (requireWorkspaceAuthorization as any).mockRejectedValue(new UnauthorizedError());

      const req = new Request(
        "http://localhost:3000/api/reports/operational/work-order-volume",
        {
          headers: {
            "x-workspace-id": mockWorkspaceId,
          },
        },
      );

      const response = await reportSlugRoute(req, {
        params: { reportSlug: ["operational", "work-order-volume"] },
      });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("GET /api/reports/[...reportSlug] returns 403 FORBIDDEN when user role lacks report permission", async () => {
      (requireWorkspaceAuthorization as any).mockResolvedValue(createMockAuthContext("TECHNICIAN"));

      const req = new Request(
        "http://localhost:3000/api/reports/financial/revenue-summary",
        {
          headers: {
            "x-workspace-id": mockWorkspaceId,
          },
        },
      );

      const response = await reportSlugRoute(req, {
        params: { reportSlug: ["financial", "revenue-summary"] },
      });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("GET /api/reports/[...reportSlug] returns 404 REPORT_NOT_FOUND on invalid report slug", async () => {
      (auth as any).mockResolvedValue({
        user: { id: "usr_mock_1" },
      });

      const req = new Request(
        "http://localhost:3000/api/reports/nonexistent/report-path",
        {
          headers: {
            "x-workspace-id": mockWorkspaceId,
          },
        },
      );

      const response = await reportSlugRoute(req, {
        params: { reportSlug: ["nonexistent", "report-path"] },
      });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error.code).toBe("REPORT_NOT_FOUND");
    });

    it("GET /api/reports/[...reportSlug] returns 404 REPORT_NOT_FOUND for deferred quotePipeline report", async () => {
      (auth as any).mockResolvedValue({
        user: { id: "usr_mock_1" },
      });

      const req = new Request(
        "http://localhost:3000/api/reports/financial/quote-pipeline",
        {
          headers: {
            "x-workspace-id": mockWorkspaceId,
          },
        },
      );

      const response = await reportSlugRoute(req, {
        params: { reportSlug: ["financial", "quote-pipeline"] },
      });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error.code).toBe("REPORT_NOT_FOUND");
    });

    it("GET /api/reports catalog route returns list of all available report definitions", async () => {
      (auth as any).mockResolvedValue({
        user: { id: "usr_mock_1" },
      });

      const req = new Request("http://localhost:3000/api/reports", {
        headers: {
          "x-workspace-id": mockWorkspaceId,
        },
      });

      const response = await reportCatalogRoute(req);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(11);

      const keys = json.data.map((r: any) => r.reportKey);
      expect(keys).toContain("operational.workOrderVolume");
      expect(keys).toContain("financial.revenueSummary");
      expect(keys).toContain("financial.quoteConversion");
    });
  });

  // =========================================================================
  // 4. Orphaned Filters Wiring Verification
  // =========================================================================
  describe("4. Orphaned Filters Wiring & Reconciliations", () => {
    it("wires timeEntryType filter in technician.productivity report", async () => {
      const mockDb: UnscopedReportDb = {
        workOrder: {
          findMany: vi.fn().mockResolvedValue([]),
          groupBy: vi.fn().mockResolvedValue([]),
        } as any,
        technicianTimeEntry: {
          findMany: vi.fn().mockImplementation((args) => {
            expect(args.where.entryType).toBe("ON_SITE");
            return Promise.resolve([
              {
                technicianProfileId: "tech_1",
                entryType: "ON_SITE",
                durationMinutes: 120,
                startedAt: new Date("2026-08-15T10:00:00Z"),
                endedAt: new Date("2026-08-15T12:00:00Z"),
                status: "COMPLETED",
              },
            ]);
          }),
        } as any,
        workOrderHistory: {
          findMany: vi.fn().mockResolvedValue([]),
        } as any,
        technicianProfile: {
          findMany: vi.fn().mockResolvedValue([
            { id: "tech_1", employee: { name: "Technician One" } },
          ]),
        } as any,
      };

      const authContext = createMockAuthContext("ADMIN");

      const report = (await composeReport(
        "technician.productivity",
        mockWorkspaceId,
        {
          preset: "THIS_MONTH",
          dimensions: [],
          timeEntryType: "ON_SITE",
        },
        authContext,
        mockDb,
      )) as ReportScalarsReadModel;

      expect(report.meta.reportKey).toBe("technician.productivity");
      expect(report.values["technicians.onSiteMinutes"]).toBe(120);
      expect(mockDb.technicianTimeEntry?.findMany).toHaveBeenCalled();
    });

    it("wires quoteStatus filter in financial.quoteConversion report", async () => {
      const mockDb: UnscopedReportDb = {
        quote: {
          findMany: vi.fn().mockImplementation((args) => {
            expect(args.where.status).toBe("APPROVED");
            return Promise.resolve([
              {
                id: "q_1",
                customerId: "cust_1",
                status: "APPROVED",
                total: new Prisma.Decimal("750.00"),
                createdAt: new Date("2026-08-15T10:00:00Z"),
              },
            ]);
          }),
        } as any,
      };

      const authContext = createMockAuthContext("ADMIN");

      const report = (await composeReport(
        "financial.quoteConversion",
        mockWorkspaceId,
        {
          preset: "THIS_MONTH",
          quoteStatus: "APPROVED",
        },
        authContext,
        mockDb,
      )) as ReportScalarsReadModel;

      expect(report.meta.reportKey).toBe("financial.quoteConversion");
      expect(report.values["quotes.approvedCount"]).toBe(1);
      expect(report.values["quotes.approvedTotal"]).toBe("750.00");
    });

    it("wires invoiceStatus filter in financial.arAging report", async () => {
      const mockDb: UnscopedReportDb = {
        invoice: {
          findMany: vi.fn().mockImplementation((args) => {
            expect(args.where.status).toBe("OVERDUE");
            return Promise.resolve([
              {
                id: "inv_1",
                customerId: "cust_1",
                currencyCode: "USD",
                amountDue: new Prisma.Decimal("450.00"),
                dueDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days past due
                issueDate: new Date("2026-07-01"),
              },
            ]);
          }),
        } as any,
        customer: {
          findMany: vi.fn().mockResolvedValue([
            { id: "cust_1", name: "Overdue Customer" },
          ]),
        } as any,
      };

      const authContext = createMockAuthContext("ADMIN");

      const report = (await composeReport(
        "financial.arAging",
        mockWorkspaceId,
        {
          invoiceStatus: "OVERDUE",
        },
        authContext,
        mockDb,
      )) as ReportRowsReadModel;

      expect(report.meta.reportKey).toBe("financial.arAging");
      expect(report.items).toHaveLength(1);
      expect(report.items[0].values.days31_60).toBe("450.00");
    });

    it("wires paymentMethod filter in financial.revenueSummary report", async () => {
      const mockDb: UnscopedReportDb = {
        invoice: {
          findMany: vi.fn().mockResolvedValue([]),
        } as any,
        payment: {
          findMany: vi.fn().mockImplementation((args) => {
            expect(args.where.paymentMethod).toBe("CREDIT_CARD");
            return Promise.resolve([
              {
                id: "pay_1",
                amount: new Prisma.Decimal("1500.00"),
                currencyCode: "USD",
                paymentMethod: "CREDIT_CARD",
                paymentDate: new Date("2026-08-15T12:00:00Z"),
                invoice: { customerId: "cust_1" },
              },
            ]);
          }),
        } as any,
      };

      const authContext = createMockAuthContext("ADMIN");

      const report = (await composeReport(
        "financial.revenueSummary",
        mockWorkspaceId,
        {
          preset: "THIS_MONTH",
          paymentMethod: "CREDIT_CARD",
        },
        authContext,
        mockDb,
      )) as ReportScalarsReadModel;

      expect(report.meta.reportKey).toBe("financial.revenueSummary");
      expect(report.values["payments.collectedRevenue"]).toBe("1500.00");
      expect(report.values["payments.collectedCount"]).toBe(1);
    });
  });
});
