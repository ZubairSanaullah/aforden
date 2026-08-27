import { describe, it, expect, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));
import { ZodError, z } from "zod";
import { NextResponse } from "next/server";
import {
  // Types & Registries
  METRIC_REGISTRY,
  DIMENSION_REGISTRY,
  FILTER_REGISTRY,
  REPORT_REGISTRY,
  getMetricDefinition,
  getDimensionDefinition,
  getFilterDefinition,
  getReportDefinition,
  registerMetric,
  unregisterMetric,
  registerDimension,
  unregisterDimension,
  registerFilter,
  unregisterFilter,
  registerReport,
  unregisterReport,
  // Errors
  ReportNotFoundError,
  UnknownMetricError,
  UnknownDimensionError,
  UnknownFilterError,
  UnsupportedMetricDimensionCombinationError,
  InvalidReportDateRangeError,
  ReportDateRangeTooLargeError,
  ReportCardinalityExceededError,
  ReportExportTooLargeError,
  ReportScopeViolationError,
  ReportingIdentifierViolationError,
  ReportMetricUnavailableError,
  // Constants
  MATERIALIZATION_TRIGGERS,
  MAX_BUCKETS_BY_GRANULARITY,
  MAX_RANGE_DAYS,
  MAX_SCAN_ROWS,
  MAX_GROUP_CARDINALITY,
  MAX_EXPORT_ROWS,
  GRANULARITY_SQL_TOKEN,
  SQL_IDENTIFIER,
  // Date Resolver & DST utilities
  resolveReportDateRange,
  zonedWallClockToUtc,
  zoneOffsetMs,
  formatLocalDateString,
  // Technician Scope
  resolveSelfTechnicianScope,
  // Schemas
  METRIC_KEYS,
  DIMENSION_KEYS,
  REPORT_KEYS,
  FILTER_KEYS,
  DATE_RANGE_PRESETS,
  DATE_BUCKET_GRANULARITIES,
  reportQueryParamsSchema,
} from "@/lib/services/reporting";
import {
  handleReportingApiError,
  extractWorkspaceId,
  resolveWorkspaceId,
  extractQueryParams,
} from "@/lib/utils/reportingApiError";
import { PERMISSIONS, ALL_PERMISSIONS } from "@/lib/services/authorization/permissions";
import { ROLE_PERMISSIONS } from "@/lib/services/authorization/rolePermissions";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

describe("Phase 1.14.2 — Reporting Foundation, Date Resolver, RBAC & Index Migration", () => {
  // =========================================================================
  // 1. Error Taxonomy (Convention B)
  // =========================================================================
  describe("1. Error Taxonomy (Convention B)", () => {
    const errorTestCases = [
      {
        ErrorClass: ReportNotFoundError,
        name: "ReportNotFoundError",
        code: "REPORT_NOT_FOUND",
        statusCode: 404,
        httpStatus: 404,
        defaultMsg: "Report definition not found.",
      },
      {
        ErrorClass: UnknownMetricError,
        name: "UnknownMetricError",
        code: "UNKNOWN_METRIC",
        statusCode: 400,
        httpStatus: 400,
        defaultMsg: "Unknown or unregistered metric key.",
      },
      {
        ErrorClass: UnknownDimensionError,
        name: "UnknownDimensionError",
        code: "UNKNOWN_DIMENSION",
        statusCode: 400,
        httpStatus: 400,
        defaultMsg: "Unknown or unregistered dimension key.",
      },
      {
        ErrorClass: UnknownFilterError,
        name: "UnknownFilterError",
        code: "UNKNOWN_FILTER",
        statusCode: 400,
        httpStatus: 400,
        defaultMsg: "Unknown or unregistered filter key.",
      },
      {
        ErrorClass: UnsupportedMetricDimensionCombinationError,
        name: "UnsupportedMetricDimensionCombinationError",
        code: "UNSUPPORTED_METRIC_DIMENSION_COMBINATION",
        statusCode: 422,
        httpStatus: 422,
        defaultMsg: "The requested metric cannot be grouped by the requested dimension.",
      },
      {
        ErrorClass: InvalidReportDateRangeError,
        name: "InvalidReportDateRangeError",
        code: "INVALID_REPORT_DATE_RANGE",
        statusCode: 422,
        httpStatus: 422,
        defaultMsg: "The requested reporting date range is invalid.",
      },
      {
        ErrorClass: ReportDateRangeTooLargeError,
        name: "ReportDateRangeTooLargeError",
        code: "REPORT_DATE_RANGE_TOO_LARGE",
        statusCode: 422,
        httpStatus: 422,
        defaultMsg: "The requested range exceeds the maximum span or bucket count for this granularity.",
      },
      {
        ErrorClass: ReportCardinalityExceededError,
        name: "ReportCardinalityExceededError",
        code: "REPORT_CARDINALITY_EXCEEDED",
        statusCode: 422,
        httpStatus: 422,
        defaultMsg: "The requested grouping or scan exceeds the maximum permitted size. Narrow the range or add a filter.",
      },
      {
        ErrorClass: ReportExportTooLargeError,
        name: "ReportExportTooLargeError",
        code: "REPORT_EXPORT_TOO_LARGE",
        statusCode: 422,
        httpStatus: 422,
        defaultMsg: "The requested export exceeds the maximum permitted row count.",
      },
      {
        ErrorClass: ReportScopeViolationError,
        name: "ReportScopeViolationError",
        code: "REPORT_SCOPE_VIOLATION",
        statusCode: 403,
        httpStatus: 403,
        defaultMsg: "The requested scope is outside your authorization for this report.",
      },
      {
        ErrorClass: ReportingIdentifierViolationError,
        name: "ReportingIdentifierViolationError",
        code: "REPORTING_IDENTIFIER_VIOLATION",
        statusCode: 500,
        httpStatus: 500,
        defaultMsg: "Internal error: a non-registry SQL identifier was rejected.",
      },
      {
        ErrorClass: ReportMetricUnavailableError,
        name: "ReportMetricUnavailableError",
        code: "REPORT_METRIC_UNAVAILABLE",
        statusCode: 501,
        httpStatus: 501,
        defaultMsg: "This metric is not derivable from the current data model.",
      },
    ];

    for (const tc of errorTestCases) {
      it(`instantiates ${tc.name} with expected metadata and default message`, () => {
        const err = new tc.ErrorClass();
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe(tc.name);
        expect(err.code).toBe(tc.code);
        expect(err.statusCode).toBe(tc.statusCode);
        expect(err.httpStatus).toBe(tc.httpStatus);
        expect(err.message).toBe(tc.defaultMsg);
      });

      it(`instantiates ${tc.name} with custom message override`, () => {
        const custom = `Custom override message for ${tc.name}`;
        const err = new tc.ErrorClass(custom);
        expect(err.message).toBe(custom);
      });
    }
  });

  // =========================================================================
  // 2. Reporting API Error Utilities
  // =========================================================================
  describe("2. Reporting API Error Utilities", () => {
    it("handles pure domain errors with proper HTTP status and JSON envelope", async () => {
      const err = new ReportDateRangeTooLargeError("Range too wide");
      const res = handleReportingApiError(err);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: {
          code: "REPORT_DATE_RANGE_TOO_LARGE",
          message: "Range too wide",
        },
      });
    });

    it("handles Zod validation errors as 422 with field errors", async () => {
      const testSchema = z.object({
        limit: z.number().max(100),
      });
      const result = testSchema.safeParse({ limit: 500 });
      expect(result.success).toBe(false);
      if (!result.success) {
        const res = handleReportingApiError(result.error);
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.error.code).toBe("VALIDATION_ERROR");
        expect(json.error.fields).toHaveProperty("limit");
      }
    });

    it("handles SyntaxError as 400 MALFORMED_JSON", async () => {
      const err = new SyntaxError("Unexpected token in JSON at position 0");
      const res = handleReportingApiError(err);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("MALFORMED_JSON");
    });

    it("handles unhandled exceptions as 500 INTERNAL_SERVER_ERROR", async () => {
      const err = new Error("Database network failure");
      const res = handleReportingApiError(err);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
    });

    it("extracts workspaceId from path, headers, or query params with correct precedence", () => {
      // 1. Path param precedence
      const req1 = new Request("http://localhost/api/reports?workspaceId=fromQuery", {
        headers: { "x-workspace-id": "fromHeader" },
      });
      expect(extractWorkspaceId(req1, "fromPath")).toBe("fromPath");

      // 2. x-workspace-id header precedence over query
      const req2 = new Request("http://localhost/api/reports?workspaceId=fromQuery", {
        headers: { "x-workspace-id": "fromHeaderX" },
      });
      expect(extractWorkspaceId(req2)).toBe("fromHeaderX");

      // 3. workspace-id header precedence over query
      const req3 = new Request("http://localhost/api/reports?workspaceId=fromQuery", {
        headers: { "workspace-id": "fromHeader" },
      });
      expect(extractWorkspaceId(req3)).toBe("fromHeader");

      // 4. Query param fallback
      const req4 = new Request("http://localhost/api/reports?workspaceId=fromQuery");
      expect(extractWorkspaceId(req4)).toBe("fromQuery");

      // 5. None provided
      const req5 = new Request("http://localhost/api/reports");
      expect(extractWorkspaceId(req5)).toBeNull();
    });

    it("resolves workspaceId or returns standardized 400 response", async () => {
      const validReq = new Request("http://localhost/api/reports?workspaceId=ws_123");
      const resolved = resolveWorkspaceId(validReq);
      expect(resolved.workspaceId).toBe("ws_123");

      const invalidReq = new Request("http://localhost/api/reports");
      const missing = resolveWorkspaceId(invalidReq);
      expect(missing.errorResponse).toBeDefined();
      expect(missing.errorResponse!.status).toBe(400);
      const json = await missing.errorResponse!.json();
      expect(json.error.code).toBe("MISSING_WORKSPACE");
    });

    it("extracts query params cleanly into a record", () => {
      const req = new Request("http://localhost/api/reports?preset=THIS_MONTH&granularity=DAY&page=2");
      const params = extractQueryParams(req);
      expect(params).toEqual({
        preset: "THIS_MONTH",
        granularity: "DAY",
        page: "2",
      });
    });
  });

  // =========================================================================
  // 3. Constants & Schema Definitions
  // =========================================================================
  describe("3. Constants & Schema Definitions", () => {
    it("locks materialization trigger thresholds (§4.5)", () => {
      expect(MATERIALIZATION_TRIGGERS.WORK_ORDER_ROWS_PER_WORKSPACE).toBe(250_000);
      expect(MATERIALIZATION_TRIGGERS.TIME_ENTRY_ROWS_PER_WORKSPACE).toBe(500_000);
      expect(MATERIALIZATION_TRIGGERS.INVOICE_ROWS_PER_WORKSPACE).toBe(200_000);
      expect(MATERIALIZATION_TRIGGERS.REPORT_P95_LATENCY_MS).toBe(1_500);
    });

    it("locks granularity bucket limits and maximum span (§5.5)", () => {
      expect(MAX_BUCKETS_BY_GRANULARITY.DAY).toBe(92);
      expect(MAX_BUCKETS_BY_GRANULARITY.WEEK).toBe(53);
      expect(MAX_BUCKETS_BY_GRANULARITY.MONTH).toBe(36);
      expect(MAX_BUCKETS_BY_GRANULARITY.QUARTER).toBe(20);
      expect(MAX_BUCKETS_BY_GRANULARITY.YEAR).toBe(10);
      expect(MAX_RANGE_DAYS).toBe(1_100);
    });

    it("locks scan, cardinality, and export caps", () => {
      expect(MAX_SCAN_ROWS).toBe(50_000);
      expect(MAX_GROUP_CARDINALITY).toBe(1_000);
      expect(MAX_EXPORT_ROWS).toBe(50_000);
    });

    it("locks SQL granularity tokens and identifier regex", () => {
      expect(GRANULARITY_SQL_TOKEN.DAY).toBe("day");
      expect(GRANULARITY_SQL_TOKEN.WEEK).toBe("week");
      expect(GRANULARITY_SQL_TOKEN.MONTH).toBe("month");
      expect(GRANULARITY_SQL_TOKEN.QUARTER).toBe("quarter");
      expect(GRANULARITY_SQL_TOKEN.YEAR).toBe("year");

      expect(SQL_IDENTIFIER.test("WorkOrder")).toBe(true);
      expect(SQL_IDENTIFIER.test("completedAt")).toBe(true);
      expect(SQL_IDENTIFIER.test("1WorkOrder")).toBe(false);
      expect(SQL_IDENTIFIER.test("WorkOrder; DROP TABLE")).toBe(false);
    });

    it("contains all locked MetricKeys + deferred, DimensionKeys, ReportKeys, and FilterKeys", () => {
      expect(METRIC_KEYS.length).toBe(63);
      expect(METRIC_KEYS).toContain("workOrders.completedCount");
      expect(METRIC_KEYS).toContain("invoices.invoicedRevenue");
      expect(METRIC_KEYS).toContain("inventory.partsConsumedCost");
      expect(METRIC_KEYS).toContain("schedule.avgAcknowledgeLatencyMinutes");
      expect(METRIC_KEYS).toContain("technicians.completedWorkOrderCount");
      expect(METRIC_KEYS).toContain("technicians.onTimeArrivalRate");
      expect(METRIC_KEYS).toContain("quotes.pipelineTotal");

      expect(DIMENSION_KEYS.length).toBe(21);
      expect(DIMENSION_KEYS).toContain("technician");
      expect(DIMENSION_KEYS).toContain("customer");
      expect(DIMENSION_KEYS).toContain("time.month");

      expect(REPORT_KEYS.length).toBe(12);
      expect(REPORT_KEYS).toContain("operational.workOrderVolume");
      expect(REPORT_KEYS).toContain("technician.productivity");
      expect(REPORT_KEYS).toContain("technician.selfScorecard");
      expect(REPORT_KEYS).toContain("financial.revenueSummary");
      expect(REPORT_KEYS).toContain("financial.quoteConversion");
      expect(REPORT_KEYS).toContain("asset.summary");

      expect(FILTER_KEYS.length).toBe(16);
      expect(FILTER_KEYS).toContain("customerId");
      expect(FILTER_KEYS).toContain("technicianId");

      expect(DATE_RANGE_PRESETS.length).toBe(14);
      expect(DATE_BUCKET_GRANULARITIES.length).toBe(5);
    });

    it("validates report query params schema", () => {
      const valid = reportQueryParamsSchema.parse({
        from: "2026-08-01",
        to: "2026-08-31",
        granularity: "DAY",
        page: "1",
        limit: "50",
      });
      expect(valid.page).toBe(1);
      expect(valid.limit).toBe(50);
      expect(valid.from).toBe("2026-08-01");

      expect(() =>
        reportQueryParamsSchema.parse({
          from: "invalid-date",
        }),
      ).toThrow();
    });
  });

  // =========================================================================
  // 4. Canonical Date-Range Resolver & DST Fixture Suite
  // =========================================================================
  describe("4. Canonical Date-Range Resolver & DST Fixture Suite", () => {
    const fixedNow = new Date("2026-08-27T12:00:00.000Z");

    describe("Presets Resolution", () => {
      it("resolves THIS_MONTH as default when neither preset nor dates are given", () => {
        const resolved = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          now: fixedNow,
        });
        expect(resolved.startLocalDate).toBe("2026-08-01");
        expect(resolved.endLocalDate).toBe("2026-08-31");
        expect(resolved.timezone).toBe("Asia/Karachi");
        expect(resolved.granularity).toBe("DAY");
        expect(resolved.bucketCount).toBe(31);
        // Asia/Karachi is UTC+5. 2026-08-01 00:00:00 PKT is 2026-07-31 19:00:00 UTC
        expect(resolved.startUtc.toISOString()).toBe("2026-07-31T19:00:00.000Z");
        // End is 2026-09-01 00:00:00 PKT which is 2026-08-31 19:00:00 UTC
        expect(resolved.endUtc.toISOString()).toBe("2026-08-31T19:00:00.000Z");
      });

      it("resolves TODAY, YESTERDAY, THIS_WEEK, LAST_WEEK, LAST_MONTH, THIS_QUARTER, THIS_YEAR", () => {
        // Today in Karachi on 2026-08-27 12:00 UTC (17:00 PKT) is 2026-08-27
        const today = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "TODAY",
          now: fixedNow,
        });
        expect(today.startLocalDate).toBe("2026-08-27");
        expect(today.endLocalDate).toBe("2026-08-27");
        expect(today.bucketCount).toBe(1);

        const yest = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "YESTERDAY",
          now: fixedNow,
        });
        expect(yest.startLocalDate).toBe("2026-08-26");
        expect(yest.endLocalDate).toBe("2026-08-26");

        // 2026-08-27 was a Thursday. Week is Mon 2026-08-24 to Sun 2026-08-30
        const thisWeek = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "THIS_WEEK",
          now: fixedNow,
        });
        expect(thisWeek.startLocalDate).toBe("2026-08-24");
        expect(thisWeek.endLocalDate).toBe("2026-08-30");

        const lastWeek = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "LAST_WEEK",
          now: fixedNow,
        });
        expect(lastWeek.startLocalDate).toBe("2026-08-17");
        expect(lastWeek.endLocalDate).toBe("2026-08-23");

        const lastMonth = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "LAST_MONTH",
          now: fixedNow,
        });
        expect(lastMonth.startLocalDate).toBe("2026-07-01");
        expect(lastMonth.endLocalDate).toBe("2026-07-31");

        const thisQuarter = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "THIS_QUARTER",
          now: fixedNow,
        });
        expect(thisQuarter.startLocalDate).toBe("2026-07-01");
        expect(thisQuarter.endLocalDate).toBe("2026-09-30");

        const thisYear = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "THIS_YEAR",
          now: fixedNow,
        });
        expect(thisYear.startLocalDate).toBe("2026-01-01");
        expect(thisYear.endLocalDate).toBe("2026-12-31");
      });

      it("resolves LAST_7_DAYS, LAST_30_DAYS, LAST_90_DAYS, LAST_12_MONTHS", () => {
        const last7 = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "LAST_7_DAYS",
          now: fixedNow,
        });
        expect(last7.startLocalDate).toBe("2026-08-21");
        expect(last7.endLocalDate).toBe("2026-08-27");
        expect(last7.bucketCount).toBe(7);

        const last30 = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "LAST_30_DAYS",
          now: fixedNow,
        });
        expect(last30.startLocalDate).toBe("2026-07-29");
        expect(last30.endLocalDate).toBe("2026-08-27");
        expect(last30.bucketCount).toBe(30);

        const last90 = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "LAST_90_DAYS",
          now: fixedNow,
        });
        expect(last90.startLocalDate).toBe("2026-05-30");
        expect(last90.endLocalDate).toBe("2026-08-27");
        expect(last90.bucketCount).toBe(90);

        const last12m = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          preset: "LAST_12_MONTHS",
          now: fixedNow,
        });
        expect(last12m.startLocalDate).toBe("2025-09-01");
        expect(last12m.endLocalDate).toBe("2026-08-31");
      });
    });

    describe("Validation & Rejection Rules", () => {
      it("throws InvalidReportDateRangeError if preset and custom dates are both provided", () => {
        expect(() =>
          resolveReportDateRange({
            workspaceTimezone: "Asia/Karachi",
            preset: "THIS_MONTH",
            fromLocalDate: "2026-08-01",
            toLocalDate: "2026-08-31",
          }),
        ).toThrow(InvalidReportDateRangeError);
      });

      it("throws InvalidReportDateRangeError if only fromLocalDate or only toLocalDate is provided", () => {
        expect(() =>
          resolveReportDateRange({
            workspaceTimezone: "Asia/Karachi",
            fromLocalDate: "2026-08-01",
          }),
        ).toThrow(InvalidReportDateRangeError);

        expect(() =>
          resolveReportDateRange({
            workspaceTimezone: "Asia/Karachi",
            toLocalDate: "2026-08-31",
          }),
        ).toThrow(InvalidReportDateRangeError);
      });

      it("throws InvalidReportDateRangeError if fromLocalDate > toLocalDate", () => {
        expect(() =>
          resolveReportDateRange({
            workspaceTimezone: "Asia/Karachi",
            fromLocalDate: "2026-08-31",
            toLocalDate: "2026-08-01",
          }),
        ).toThrow(InvalidReportDateRangeError);
      });

      it("throws InvalidReportDateRangeError on non-calendar or malformed dates", () => {
        expect(() =>
          resolveReportDateRange({
            workspaceTimezone: "Asia/Karachi",
            fromLocalDate: "2026-02-30",
            toLocalDate: "2026-03-05",
          }),
        ).toThrow(InvalidReportDateRangeError);

        expect(() =>
          resolveReportDateRange({
            workspaceTimezone: "Asia/Karachi",
            fromLocalDate: "2026-13-01",
            toLocalDate: "2026-13-10",
          }),
        ).toThrow(InvalidReportDateRangeError);

        expect(() =>
          resolveReportDateRange({
            workspaceTimezone: "Asia/Karachi",
            fromLocalDate: "2026-08-01T00:00:00Z",
            toLocalDate: "2026-08-31",
          }),
        ).toThrow(InvalidReportDateRangeError);
      });

      it("throws InvalidReportDateRangeError on invalid timezone", () => {
        expect(() =>
          resolveReportDateRange({
            workspaceTimezone: "Invalid/Fake_Zone",
            fromLocalDate: "2026-08-01",
            toLocalDate: "2026-08-31",
          }),
        ).toThrow(InvalidReportDateRangeError);
      });

      it("throws ReportDateRangeTooLargeError if requested granularity exceeds bucket cap", () => {
        // DAY cap is 92. Requesting 100 days with DAY granularity should throw.
        expect(() =>
          resolveReportDateRange({
            workspaceTimezone: "Asia/Karachi",
            fromLocalDate: "2026-01-01",
            toLocalDate: "2026-04-15", // 105 days
            granularity: "DAY",
          }),
        ).toThrow(ReportDateRangeTooLargeError);
      });

      it("throws ReportDateRangeTooLargeError if span exceeds MAX_RANGE_DAYS (1,100 days)", () => {
        expect(() =>
          resolveReportDateRange({
            workspaceTimezone: "Asia/Karachi",
            fromLocalDate: "2020-01-01",
            toLocalDate: "2024-01-01", // ~1,460 days
            granularity: "YEAR",
          }),
        ).toThrow(ReportDateRangeTooLargeError);
      });
    });

    describe("Half-Open Interval Tiling [startUtc, endUtc)", () => {
      it("verifies 12 monthly ranges for a year tile perfectly with no gap and no overlap", () => {
        const tz = "Asia/Karachi";
        const yearRange = resolveReportDateRange({
          workspaceTimezone: tz,
          fromLocalDate: "2026-01-01",
          toLocalDate: "2026-12-31",
        });

        const months = [
          { from: "2026-01-01", to: "2026-01-31" },
          { from: "2026-02-01", to: "2026-02-28" },
          { from: "2026-03-01", to: "2026-03-31" },
          { from: "2026-04-01", to: "2026-04-30" },
          { from: "2026-05-01", to: "2026-05-31" },
          { from: "2026-06-01", to: "2026-06-30" },
          { from: "2026-07-01", to: "2026-07-31" },
          { from: "2026-08-01", to: "2026-08-31" },
          { from: "2026-09-01", to: "2026-09-30" },
          { from: "2026-10-01", to: "2026-10-31" },
          { from: "2026-11-01", to: "2026-11-30" },
          { from: "2026-12-01", to: "2026-12-31" },
        ];

        const monthRanges = months.map((m) =>
          resolveReportDateRange({
            workspaceTimezone: tz,
            fromLocalDate: m.from,
            toLocalDate: m.to,
          }),
        );

        // First month start matches annual start
        expect(monthRanges[0].startUtc.getTime()).toBe(yearRange.startUtc.getTime());

        // Last month end matches annual end
        expect(monthRanges[11].endUtc.getTime()).toBe(yearRange.endUtc.getTime());

        // Consecutive months tile with exact boundary equality
        for (let i = 0; i < monthRanges.length - 1; i++) {
          expect(monthRanges[i].endUtc.getTime()).toBe(monthRanges[i + 1].startUtc.getTime());
        }
      });
    });

    describe("Mandatory 5-Scenario DST Fixture Suite (§5.6)", () => {
      it("Scenario 1: Asia/Karachi (No DST, schema default — constant UTC+5)", () => {
        const winter = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          fromLocalDate: "2026-01-15",
          toLocalDate: "2026-01-15",
        });
        // 2026-01-15 00:00 PKT = 2026-01-14 19:00 UTC (offset = -5h = -18000000ms)
        expect(winter.startUtc.toISOString()).toBe("2026-01-14T19:00:00.000Z");
        expect(winter.endUtc.toISOString()).toBe("2026-01-15T19:00:00.000Z");
        expect(winter.endUtc.getTime() - winter.startUtc.getTime()).toBe(86_400_000);

        const summer = resolveReportDateRange({
          workspaceTimezone: "Asia/Karachi",
          fromLocalDate: "2026-07-15",
          toLocalDate: "2026-07-15",
        });
        expect(summer.startUtc.toISOString()).toBe("2026-07-14T19:00:00.000Z");
        expect(summer.endUtc.toISOString()).toBe("2026-07-15T19:00:00.000Z");
      });

      it("Scenario 2: America/New_York (Spring-Forward March & Fall-Back November)", () => {
        // 2026 Spring Forward in US is Sunday, March 8, 2026 (23 hours long day)
        const springDay = resolveReportDateRange({
          workspaceTimezone: "America/New_York",
          fromLocalDate: "2026-03-08",
          toLocalDate: "2026-03-08",
        });
        // Midnight on Mar 8 is EST (UTC-5) -> 05:00 UTC
        expect(springDay.startUtc.toISOString()).toBe("2026-03-08T05:00:00.000Z");
        // Midnight on Mar 9 is EDT (UTC-4) -> 04:00 UTC
        expect(springDay.endUtc.toISOString()).toBe("2026-03-09T04:00:00.000Z");
        // Duration of spring forward day is 23 hours = 82,800,000 ms
        expect(springDay.endUtc.getTime() - springDay.startUtc.getTime()).toBe(23 * 3600 * 1000);

        // 2026 Fall Back in US is Sunday, November 1, 2026 (25 hours long day)
        const fallDay = resolveReportDateRange({
          workspaceTimezone: "America/New_York",
          fromLocalDate: "2026-11-01",
          toLocalDate: "2026-11-01",
        });
        // Midnight on Nov 1 is EDT (UTC-4) -> 04:00 UTC
        expect(fallDay.startUtc.toISOString()).toBe("2026-11-01T04:00:00.000Z");
        // Midnight on Nov 2 is EST (UTC-5) -> 05:00 UTC
        expect(fallDay.endUtc.toISOString()).toBe("2026-11-02T05:00:00.000Z");
        // Duration of fall back day is 25 hours = 90,000,000 ms
        expect(fallDay.endUtc.getTime() - fallDay.startUtc.getTime()).toBe(25 * 3600 * 1000);
      });

      it("Scenario 3: Australia/Sydney (Southern Hemisphere Transitions)", () => {
        // Fall back in Sydney occurs on Sunday, April 5, 2026 (UTC+11 -> UTC+10, 25 hours)
        const sydFall = resolveReportDateRange({
          workspaceTimezone: "Australia/Sydney",
          fromLocalDate: "2026-04-05",
          toLocalDate: "2026-04-05",
        });
        // Midnight Apr 5 is AEDT (UTC+11) -> Apr 4 13:00 UTC
        expect(sydFall.startUtc.toISOString()).toBe("2026-04-04T13:00:00.000Z");
        // Midnight Apr 6 is AEST (UTC+10) -> Apr 5 14:00 UTC
        expect(sydFall.endUtc.toISOString()).toBe("2026-04-05T14:00:00.000Z");
        expect(sydFall.endUtc.getTime() - sydFall.startUtc.getTime()).toBe(25 * 3600 * 1000);

        // Spring forward in Sydney occurs on Sunday, October 4, 2026 (UTC+10 -> UTC+11, 23 hours)
        const sydSpring = resolveReportDateRange({
          workspaceTimezone: "Australia/Sydney",
          fromLocalDate: "2026-10-04",
          toLocalDate: "2026-10-04",
        });
        // Midnight Oct 4 is AEST (UTC+10) -> Oct 3 14:00 UTC
        expect(sydSpring.startUtc.toISOString()).toBe("2026-10-03T14:00:00.000Z");
        // Midnight Oct 5 is AEDT (UTC+11) -> Oct 4 13:00 UTC
        expect(sydSpring.endUtc.toISOString()).toBe("2026-10-04T13:00:00.000Z");
        expect(sydSpring.endUtc.getTime() - sydSpring.startUtc.getTime()).toBe(23 * 3600 * 1000);
      });

      it("Scenario 4: Asia/Kathmandu (Sub-hour offset UTC+05:45)", () => {
        const ktm = resolveReportDateRange({
          workspaceTimezone: "Asia/Kathmandu",
          fromLocalDate: "2026-08-01",
          toLocalDate: "2026-08-01",
        });
        // Midnight KTM is UTC-5h45m -> 2026-07-31 18:15:00 UTC
        expect(ktm.startUtc.toISOString()).toBe("2026-07-31T18:15:00.000Z");
        expect(ktm.endUtc.toISOString()).toBe("2026-08-01T18:15:00.000Z");
        expect(ktm.endUtc.getTime() - ktm.startUtc.getTime()).toBe(86_400_000);
      });

      it("Scenario 5: Midnight Transition Zone / Non-existent Wall Clock Disambiguation", () => {
        // Test zonedWallClockToUtc directly for spring-forward gap disambiguation
        // In America/New_York on 2026-03-08, 02:30:00 AM does not exist (skips from 02:00 to 03:00)
        const gapInstant = zonedWallClockToUtc(2026, 3, 8, 2, 30, 0, "America/New_York");
        expect(gapInstant).toBeInstanceOf(Date);
        expect(!isNaN(gapInstant.getTime())).toBe(true);

        // Fall-back ambiguous time in America/New_York on 2026-11-01 at 01:30:00 AM (occurs twice)
        // Disambiguation rule: resolve to earlier occurrence
        const overlapInstant = zonedWallClockToUtc(2026, 11, 1, 1, 30, 0, "America/New_York");
        // Earlier occurrence is EDT (UTC-4), so 01:30 EDT = 05:30 UTC
        expect(overlapInstant.toISOString()).toBe("2026-11-01T05:30:00.000Z");
      });
    });
  });

  // =========================================================================
  // 5. Empty Registries & Open-Closed Accessors
  // =========================================================================
  describe("5. Empty Registries & Open-Closed Accessors", () => {
    it("throws UnknownMetricError for unregistered metric keys", () => {
      expect(() => getMetricDefinition("unregistered.fakeMetric" as any)).toThrow(UnknownMetricError);
    });

    it("throws UnknownDimensionError for unregistered dimension keys", () => {
      expect(() => getDimensionDefinition("unregistered.fakeDimension" as any)).toThrow(UnknownDimensionError);
    });

    it("throws UnknownFilterError for unregistered filter keys", () => {
      expect(() => getFilterDefinition("unregistered.fakeFilter" as any)).toThrow(UnknownFilterError);
    });

    it("throws ReportNotFoundError for unregistered report keys", () => {
      expect(() => getReportDefinition("financial.quotePipeline" as any)).toThrow(ReportNotFoundError);
    });

    it("verifies Open-Closed property: register metric definition, verify lookup, unregister", () => {
      const mockMetric: any = {
        key: "quotes.winRate",
        category: "FINANCIAL",
        valueType: "RATE_PERCENT",
        temporality: "PERIOD",
        sourceModel: "Quote",
        dateAnchor: { model: "Quote", field: "createdAt" },
        baseWhere: () => ({}),
        aggregation: { kind: "RATE", numerator: "quotes.approvedCount", denominator: "quotes.createdCount" },
        requiredPermission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
        supportedDimensions: [],
        isSnapshotDerived: true,
        materializationTrigger: null,
        description: "Test quotes win rate",
      };

      registerMetric(mockMetric);
      expect(getMetricDefinition("quotes.winRate" as any)).toEqual(mockMetric);
      unregisterMetric("quotes.winRate" as any);
      expect(() => getMetricDefinition("quotes.winRate" as any)).toThrow(UnknownMetricError);
    });

    it("verifies Open-Closed property for dimension, filter, and report registries", () => {
      // Dimension
      const mockDim: any = {
        key: "quoteStatus",
        kind: "COLUMN",
        groupByField: "status",
        labelSource: { kind: "ENUM" },
        cardinalityClass: "LOW",
        applicableModels: ["Quote"],
        description: "Quote status dimension",
      };
      registerDimension(mockDim);
      expect(getDimensionDefinition("quoteStatus" as any)).toEqual(mockDim);
      unregisterDimension("quoteStatus" as any);
      expect(() => getDimensionDefinition("quoteStatus" as any)).toThrow(UnknownDimensionError);

      // Filter
      const mockFilter: any = {
        key: "quoteStatus",
        valueType: "ENUM",
        applicableModels: ["Quote"],
        buildWhere: (v: unknown) => ({ status: v }),
        requiresTenantValidation: false,
      };
      registerFilter(mockFilter);
      expect(getFilterDefinition("quoteStatus" as any)).toEqual(mockFilter);
      unregisterFilter("quoteStatus" as any);
      expect(() => getFilterDefinition("quoteStatus" as any)).toThrow(UnknownFilterError);

      // Report
      const mockReport: any = {
        reportKey: "financial.quotePipeline",
        category: "FINANCIAL",
        title: "Quote Pipeline",
        metrics: ["quotes.winRate"],
        allowedDimensions: ["quoteStatus"],
        allowedFilters: ["quoteStatus"],
        allowedSortKeys: ["quotes.winRate"],
        defaultSort: { key: "quotes.winRate", order: "desc" },
        requiredPermission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
        selfScopedRoles: [],
        supportsTimeSeries: true,
        supportsCsvExport: true,
        paramsSchema: z.object({}),
        description: "Quote pipeline report",
      };
      registerReport(mockReport);
      expect(getReportDefinition("financial.quotePipeline" as any)).toEqual(mockReport);
      unregisterReport("financial.quotePipeline" as any);
      expect(() => getReportDefinition("financial.quotePipeline" as any)).toThrow(ReportNotFoundError);
    });
  });

  // =========================================================================
  // 6. RBAC & Permissions Matrix (§7.1, §7.2)
  // =========================================================================
  describe("6. RBAC & Permissions Matrix (§7.1, §7.2)", () => {
    it("confirms all 4 new permissions exist in PERMISSIONS and ALL_PERMISSIONS", () => {
      expect(PERMISSIONS.REPORTS_VIEW_OPERATIONAL).toBe("reports.view_operational");
      expect(PERMISSIONS.REPORTS_VIEW_FINANCIAL).toBe("reports.view_financial");
      expect(PERMISSIONS.REPORTS_VIEW_TECHNICIAN).toBe("reports.view_technician");
      expect(PERMISSIONS.REPORTS_EXPORT).toBe("reports.export");

      expect(ALL_PERMISSIONS).toContain("reports.view_operational");
      expect(ALL_PERMISSIONS).toContain("reports.view_financial");
      expect(ALL_PERMISSIONS).toContain("reports.view_technician");
      expect(ALL_PERMISSIONS).toContain("reports.export");
    });

    it("verifies ROLE_PERMISSIONS matrix matches §7.2 exactly", () => {
      // OWNER has all permissions
      expect(ROLE_PERMISSIONS.OWNER).toContain(PERMISSIONS.REPORTS_VIEW_OPERATIONAL);
      expect(ROLE_PERMISSIONS.OWNER).toContain(PERMISSIONS.REPORTS_VIEW_FINANCIAL);
      expect(ROLE_PERMISSIONS.OWNER).toContain(PERMISSIONS.REPORTS_VIEW_TECHNICIAN);
      expect(ROLE_PERMISSIONS.OWNER).toContain(PERMISSIONS.REPORTS_EXPORT);

      // ADMIN has all 4
      expect(ROLE_PERMISSIONS.ADMIN).toContain(PERMISSIONS.REPORTS_VIEW_OPERATIONAL);
      expect(ROLE_PERMISSIONS.ADMIN).toContain(PERMISSIONS.REPORTS_VIEW_FINANCIAL);
      expect(ROLE_PERMISSIONS.ADMIN).toContain(PERMISSIONS.REPORTS_VIEW_TECHNICIAN);
      expect(ROLE_PERMISSIONS.ADMIN).toContain(PERMISSIONS.REPORTS_EXPORT);

      // MANAGER has all 4
      expect(ROLE_PERMISSIONS.MANAGER).toContain(PERMISSIONS.REPORTS_VIEW_OPERATIONAL);
      expect(ROLE_PERMISSIONS.MANAGER).toContain(PERMISSIONS.REPORTS_VIEW_FINANCIAL);
      expect(ROLE_PERMISSIONS.MANAGER).toContain(PERMISSIONS.REPORTS_VIEW_TECHNICIAN);
      expect(ROLE_PERMISSIONS.MANAGER).toContain(PERMISSIONS.REPORTS_EXPORT);

      // DISPATCHER has operational + technician only
      expect(ROLE_PERMISSIONS.DISPATCHER).toContain(PERMISSIONS.REPORTS_VIEW_OPERATIONAL);
      expect(ROLE_PERMISSIONS.DISPATCHER).toContain(PERMISSIONS.REPORTS_VIEW_TECHNICIAN);
      expect(ROLE_PERMISSIONS.DISPATCHER).not.toContain(PERMISSIONS.REPORTS_VIEW_FINANCIAL);
      expect(ROLE_PERMISSIONS.DISPATCHER).not.toContain(PERMISSIONS.REPORTS_EXPORT);

      // TECHNICIAN has technician only
      expect(ROLE_PERMISSIONS.TECHNICIAN).toContain(PERMISSIONS.REPORTS_VIEW_TECHNICIAN);
      expect(ROLE_PERMISSIONS.TECHNICIAN).not.toContain(PERMISSIONS.REPORTS_VIEW_OPERATIONAL);
      expect(ROLE_PERMISSIONS.TECHNICIAN).not.toContain(PERMISSIONS.REPORTS_VIEW_FINANCIAL);
      expect(ROLE_PERMISSIONS.TECHNICIAN).not.toContain(PERMISSIONS.REPORTS_EXPORT);

      // ACCOUNTANT has operational + financial + export only
      expect(ROLE_PERMISSIONS.ACCOUNTANT).toContain(PERMISSIONS.REPORTS_VIEW_OPERATIONAL);
      expect(ROLE_PERMISSIONS.ACCOUNTANT).toContain(PERMISSIONS.REPORTS_VIEW_FINANCIAL);
      expect(ROLE_PERMISSIONS.ACCOUNTANT).toContain(PERMISSIONS.REPORTS_EXPORT);
      expect(ROLE_PERMISSIONS.ACCOUNTANT).not.toContain(PERMISSIONS.REPORTS_VIEW_TECHNICIAN);
    });
  });

  // =========================================================================
  // 7. Technician Scope Resolution (§7.3)
  // =========================================================================
  describe("7. Technician Scope Resolution (§7.3)", () => {
    it("resolves technicianProfile.id when employee profile exists", async () => {
      const mockDb: any = {
        employee: {
          findFirst: async () => ({
            technicianProfile: { id: "tech_prof_123" },
          }),
        },
      };

      const mockAuth: any = {
        membership: { id: "mem_abc", role: "TECHNICIAN" },
        workspace: { id: "ws_123", timezone: "Asia/Karachi" },
      };

      const techId = await resolveSelfTechnicianScope("ws_123", mockAuth, mockDb);
      expect(techId).toBe("tech_prof_123");
    });

    it("throws ReportScopeViolationError when viewer has no technician profile", async () => {
      const mockDb: any = {
        employee: {
          findFirst: async () => null,
        },
      };

      const mockAuth: any = {
        membership: { id: "mem_abc", role: "TECHNICIAN" },
        workspace: { id: "ws_123", timezone: "Asia/Karachi" },
      };

      await expect(
        resolveSelfTechnicianScope("ws_123", mockAuth, mockDb),
      ).rejects.toThrow(ReportScopeViolationError);
    });
  });
});
