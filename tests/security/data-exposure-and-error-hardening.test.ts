/**
 * Phase 1.20.6 — Data Exposure & Error Handling Hardening Test Suite
 *
 * Covers:
 * 1. CSV Export Streaming (SEC-04)
 *    a. generateReportCsvChunks: iterative chunked generation for SCALARS, ROWS, and SERIES
 *    b. createReportCsvStream: Web standard ReadableStream<Uint8Array> with chunked transfer
 *    c. MAX_EXPORT_ROWS: row count ceiling enforcement against DoS for both ROWS and SERIES
 *    d. HTTP Route streaming: GET /api/reports and GET /api/reports/[...reportSlug] with format=csv return streamed chunked response
 * 2. Error Message Leakage Hardening (SEC-05 + General Sweep)
 *    a. Inbound webhook route (POST /api/integrations/webhooks/[slug]): unhandled pipeline failure
 *       returns sanitized 500 with zero internal details / connection string leakage
 *    b. handleIntegrationApiError: unexpected internal error returns sanitized 500 response
 *    c. handlePlatformError: unexpected internal error returns sanitized 500 response
 *    d. handleNotificationApiError: unexpected internal error returns sanitized 500 response
 *    e. Billing webhook route: signature failure returns sanitized 400 response
 * 3. Mechanical Global Error Leakage Audit:
 *    Scan of all 208 route handlers and error utilities to confirm 0 raw error pass-through in 500 paths
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workOrder: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    user: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
  requireWorkspaceAuthorization: vi.fn().mockResolvedValue({
    user: { id: "usr_mock_1", name: "Admin User", email: "admin@aforden.test" },
    workspace: { id: "ws_test_sec_04", name: "Test Workspace", timezone: "UTC" },
    membership: { role: "ADMIN" },
  }),
}));

vi.mock("@/lib/services/reporting/reportEngine", () => ({
  composeReport: vi.fn(),
}));

// Mock pipeline before importing route handlers to isolate unit test
vi.mock("@/lib/integrations/webhooks/webhookPipeline", () => ({
  processInboundWebhook: vi.fn(),
}));

vi.mock("@/lib/services/billing", () => ({
  getBillingAdapter: vi.fn().mockReturnValue({
    verifyAndConstructWebhookEvent: vi.fn().mockRejectedValue(new Error("Stripe signature validation failed")),
  }),
  processBillingWebhookEvent: vi.fn(),
}));

import {
  generateReportCsvChunks,
  createReportCsvStream,
  serializeReportToCsv,
} from "@/lib/services/reporting/csvSerializer";
import { MAX_EXPORT_ROWS } from "@/lib/services/reporting/reportingConstants";
import { ReportCardinalityExceededError } from "@/lib/services/reporting/reportingErrors";
import type {
  ReportScalarsReadModel,
  ReportRowsReadModel,
  ReportSeriesReadModel,
} from "@/lib/services/reporting/reporting.types";
import { handleIntegrationApiError } from "@/lib/utils/integrationApiError";
import { handlePlatformError } from "@/lib/services/platform/transport/httpHandler";
import { handleNotificationApiError } from "@/lib/utils/notificationApiError";
import { POST as inboundWebhookHandler } from "@/app/api/integrations/webhooks/[slug]/route";
import { POST as billingWebhookHandler } from "@/app/api/billing/webhooks/[provider]/route";
import { GET as reportCatalogRoute } from "@/app/api/reports/route";
import { GET as reportSlugRoute } from "@/app/api/reports/[...reportSlug]/route";
import { composeReport } from "@/lib/services/reporting/reportEngine";
import { processInboundWebhook } from "@/lib/integrations/webhooks/webhookPipeline";
import fs from "fs";
import path from "path";

describe("Phase 1.20.6 — Data Exposure & Error Handling Hardening Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. CSV Export Streaming & Bound Enforcement (SEC-04)
  // =========================================================================
  describe("1. CSV Export Streaming & Bound Enforcement (SEC-04)", () => {
    const mockScalarReport: ReportScalarsReadModel = {
      meta: {
        reportKey: "operational.workOrderVolume",
        title: "Work Order Volume",
        shape: "SCALARS",
        scope: "WORKSPACE",
        generatedAt: new Date().toISOString(),
        timezone: "UTC",
        range: {
          startUtc: "2026-01-01T00:00:00Z",
          endUtc: "2026-01-31T23:59:59.999Z",
          startLocalDate: "2026-01-01",
          endLocalDate: "2026-01-31",
          preset: null,
          granularity: "DAY",
        },
        asOfUtc: null,
        metrics: [
          { key: "workOrders.createdCount", label: "Created Work Orders", valueType: "COUNT", temporality: "PERIOD" },
          { key: "workOrders.completedCount", label: "Completed Work Orders", valueType: "COUNT", temporality: "PERIOD" },
        ],
        dimensions: [],
        appliedFilters: [],
        sort: { key: "workOrders.createdCount", order: "desc" },
        sortedInMemory: false,
        truncated: false,
      },
      values: {
        "workOrders.createdCount": 42,
        "workOrders.completedCount": 38,
      },
    };

    const mockRowsReport: ReportRowsReadModel = {
      meta: {
        reportKey: "inventory.partsConsumption",
        title: "Parts Consumption",
        shape: "ROWS",
        scope: "WORKSPACE",
        generatedAt: new Date().toISOString(),
        timezone: "UTC",
        range: {
          startUtc: "2026-01-01T00:00:00Z",
          endUtc: "2026-01-31T23:59:59.999Z",
          startLocalDate: "2026-01-01",
          endLocalDate: "2026-01-31",
          preset: null,
          granularity: "DAY",
        },
        asOfUtc: null,
        metrics: [
          { key: "inventory.partsConsumedQuantity", label: "Quantity", valueType: "COUNT", temporality: "PERIOD" },
          { key: "inventory.partsConsumedCost", label: "Total Cost", valueType: "SUM_MONEY", temporality: "PERIOD" },
        ],
        dimensions: [{ key: "part", label: "Part Name" }],
        appliedFilters: [],
        sort: { key: "inventory.partsConsumedCost", order: "desc" },
        sortedInMemory: false,
        truncated: false,
      },
      items: [
        {
          dimensions: { part: { key: "p1", label: "Air Filter 16x25, Heavy Duty" } },
          values: {
            "inventory.partsConsumedQuantity": 15,
            "inventory.partsConsumedCost": "225.50",
          },
        },
        {
          dimensions: { part: { key: "p2", label: "Capacitor 45/5 MFD" } },
          values: {
            "inventory.partsConsumedQuantity": 8,
            "inventory.partsConsumedCost": "120.00",
          },
        },
      ],
      total: 2,
      page: 1,
      limit: 100,
      totalPages: 1,
    };

    const mockSeriesReport: ReportSeriesReadModel = {
      meta: {
        reportKey: "operational.workOrderVolume",
        title: "Work Order Volume Over Time",
        shape: "SERIES",
        scope: "WORKSPACE",
        generatedAt: new Date().toISOString(),
        timezone: "UTC",
        range: {
          startUtc: "2026-01-01T00:00:00Z",
          endUtc: "2026-01-03T23:59:59.999Z",
          startLocalDate: "2026-01-01",
          endLocalDate: "2026-01-03",
          preset: null,
          granularity: "DAY",
        },
        asOfUtc: null,
        metrics: [
          { key: "workOrders.createdCount", label: "Created Work Orders", valueType: "COUNT", temporality: "PERIOD" },
        ],
        dimensions: [{ key: "time.day", label: "Day" }],
        appliedFilters: [],
        sort: { key: "time.day", order: "asc" },
        sortedInMemory: false,
        truncated: false,
      },
      series: [
        {
          bucketStartUtc: "2026-01-01T00:00:00Z",
          bucketLocalLabel: "2026-01-01",
          values: { "workOrders.createdCount": 10 },
        },
        {
          bucketStartUtc: "2026-01-02T00:00:00Z",
          bucketLocalLabel: "2026-01-02",
          values: { "workOrders.createdCount": 15 },
        },
      ],
    };

    it("generateReportCsvChunks: generates chunked CSV lines iteratively for SCALARS", () => {
      const chunks = Array.from(generateReportCsvChunks(mockScalarReport, 10));
      expect(chunks.length).toBeGreaterThan(0);
      const fullText = chunks.join("");
      expect(fullText).toContain("Metric,Value");
      expect(fullText).toContain("Created Work Orders,42");
      expect(fullText).toContain("Completed Work Orders,38");
    });

    it("generateReportCsvChunks: escapes RFC 4180 characters properly in chunks", () => {
      const chunks = Array.from(generateReportCsvChunks(mockRowsReport, 1));
      const fullText = chunks.join("");
      // "Air Filter 16x25, Heavy Duty" contains a comma, so must be quoted
      expect(fullText).toContain('"Air Filter 16x25, Heavy Duty",15,225.50');
      expect(fullText).toContain("Capacitor 45/5 MFD,8,120.00");
    });

    it("generateReportCsvChunks: generates chunked CSV lines for SERIES shape", () => {
      const chunks = Array.from(generateReportCsvChunks(mockSeriesReport, 1));
      const fullText = chunks.join("");
      expect(fullText).toContain("Bucket (UTC),Bucket (Local),Created Work Orders");
      expect(fullText).toContain("2026-01-01T00:00:00Z,2026-01-01,10");
      expect(fullText).toContain("2026-01-02T00:00:00Z,2026-01-02,15");
    });

    it("createReportCsvStream: produces a valid ReadableStream<Uint8Array>", async () => {
      const stream = createReportCsvStream(mockRowsReport, 1);
      expect(stream).toBeInstanceOf(ReadableStream);

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let streamedOutput = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        streamedOutput += decoder.decode(value, { stream: true });
      }

      expect(streamedOutput).toContain("Part Name,Quantity,Total Cost");
      expect(streamedOutput).toContain('"Air Filter 16x25, Heavy Duty",15,225.50');
    });

    it("MAX_EXPORT_ROWS: enforces export row ceiling on ROWS shape and throws ReportCardinalityExceededError", () => {
      const largeRowsReport: ReportRowsReadModel = {
        ...mockRowsReport,
        items: new Array(MAX_EXPORT_ROWS + 1).fill({
          dimensions: { part: { key: "p", label: "Test Part" } },
          values: { "inventory.partsConsumedQuantity": 1, "inventory.partsConsumedCost": "10.00" },
        }),
      };

      expect(() => {
        Array.from(generateReportCsvChunks(largeRowsReport));
      }).toThrow(ReportCardinalityExceededError);
    });

    it("MAX_EXPORT_ROWS: enforces export row ceiling on SERIES shape and throws ReportCardinalityExceededError", () => {
      const largeSeriesReport: ReportSeriesReadModel = {
        ...mockSeriesReport,
        series: new Array(MAX_EXPORT_ROWS + 1).fill({
          bucketStartUtc: "2026-01-01T00:00:00Z",
          bucketLocalLabel: "2026-01-01",
          values: { "workOrders.createdCount": 1 },
        }),
      };

      expect(() => {
        Array.from(generateReportCsvChunks(largeSeriesReport));
      }).toThrow(ReportCardinalityExceededError);
    });

    it("serializeReportToCsv backwards compatibility: matches stream output", async () => {
      const stringOutput = serializeReportToCsv(mockRowsReport);

      const stream = createReportCsvStream(mockRowsReport);
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let streamOutput = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        streamOutput += decoder.decode(value, { stream: true });
      }

      expect(stringOutput).toBe(streamOutput);
    });

    it("HTTP Route Streaming: GET /api/reports with format=csv returns chunked streamed CSV response", async () => {
      vi.mocked(composeReport).mockResolvedValueOnce(mockScalarReport);

      const req = new Request("http://localhost:3000/api/reports?reportKey=operational.workOrderVolume&format=csv", {
        headers: { "x-workspace-id": "ws_test_sec_04" },
      });

      const response = await reportCatalogRoute(req);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv; charset=utf-8");
      expect(response.headers.get("content-disposition")).toContain('attachment; filename="operational-workOrderVolume.csv"');
      expect(response.headers.get("transfer-encoding")).toBe("chunked");

      const text = await response.text();
      expect(text).toContain("Metric,Value");
      expect(text).toContain("Created Work Orders,42");
    });

    it("HTTP Route Streaming: GET /api/reports/[...reportSlug] with format=csv returns chunked streamed CSV response", async () => {
      vi.mocked(composeReport).mockResolvedValueOnce(mockRowsReport);

      const req = new Request("http://localhost:3000/api/reports/inventory/parts-consumption?format=csv", {
        headers: { "x-workspace-id": "ws_test_sec_04" },
      });

      const response = await reportSlugRoute(req, {
        params: Promise.resolve({ reportSlug: ["inventory", "parts-consumption"] }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv; charset=utf-8");
      expect(response.headers.get("content-disposition")).toContain('attachment; filename="inventory-partsConsumption.csv"');
      expect(response.headers.get("transfer-encoding")).toBe("chunked");

      const text = await response.text();
      expect(text).toContain("Part Name,Quantity,Total Cost");
      expect(text).toContain('"Air Filter 16x25, Heavy Duty",15,225.50');
    });
  });

  // =========================================================================
  // 2. Error Message Leakage Hardening (SEC-05 + General Sweep)
  // =========================================================================
  describe("2. Error Message Leakage Hardening (SEC-05)", () => {
    it("Inbound Webhook Route: unhandled pipeline crash returns sanitized 500 without leaking DB internals", async () => {
      vi.mocked(processInboundWebhook).mockRejectedValueOnce(
        new Error("PrismaClientKnownRequestError: Table 'aforden.secrets' does not exist at postgres://admin:supersecret@10.0.0.5:5432/aforden_db")
      );

      const request = new Request("http://localhost:3000/api/integrations/webhooks/test-hook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "order.created" }),
      });

      const response = await inboundWebhookHandler(request, {
        params: Promise.resolve({ slug: "test-hook" }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();

      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(body.error.message).toBe("An unexpected error occurred while processing the webhook.");
      // Assert zero leakage of DB connection strings, table names, or credentials
      expect(JSON.stringify(body)).not.toContain("postgres://");
      expect(JSON.stringify(body)).not.toContain("supersecret");
      expect(JSON.stringify(body)).not.toContain("aforden.secrets");
    });

    it("handleIntegrationApiError: sanitizes unexpected internal errors (500)", async () => {
      const sensitiveError = new Error("FATAL: connect ECONNREFUSED redis://auth:secretkey@internal-redis:6379");
      const res = handleIntegrationApiError(sensitiveError, "POST /api/integrations/test");

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(body.error.message).toBe("An unexpected error occurred while processing the integration request.");
      expect(JSON.stringify(body)).not.toContain("redis://");
      expect(JSON.stringify(body)).not.toContain("secretkey");
    });

    it("handlePlatformError: sanitizes generic fallback errors (500)", async () => {
      const sensitiveError = new Error("Platform internal crash: failed to decrypt token with KMS ARN arn:aws:kms:us-east-1:123456789012:key/abc-123");
      const res = handlePlatformError(sensitiveError);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).toBe("An unexpected platform error occurred.");
      expect(JSON.stringify(body)).not.toContain("arn:aws:kms");
      expect(JSON.stringify(body)).not.toContain("123456789012");
    });

    it("handleNotificationApiError: sanitizes generic fallback errors (500)", async () => {
      const sensitiveError = new Error("Provider authentication failure: HTTP 401 with api_key=resend_live_sec_987654321");
      const res = handleNotificationApiError(sensitiveError, "POST /api/notifications");

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(body.error.message).toBe("An unexpected error occurred while processing notification request.");
      expect(JSON.stringify(body)).not.toContain("resend_live_sec");
    });

    it("Billing Webhook Route: invalid signature returns sanitized 400 error", async () => {
      const request = new Request("http://localhost:3000/api/billing/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "t=123,v1=invalid_sig" },
        body: JSON.stringify({ type: "invoice.paid" }),
      });

      const response = await billingWebhookHandler(request, {
        params: Promise.resolve({ provider: "stripe" }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe("Invalid webhook signature or payload.");
    });
  });

  // =========================================================================
  // 3. Mechanical Global Error Leakage Audit
  // =========================================================================
  describe("3. Mechanical Global Error Leakage Audit", () => {
    it("AUDIT: No route or error utility leaks raw error.message in 500 / internal error responses", () => {
      function getFiles(dir: string): string[] {
        let files: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files = files.concat(getFiles(full));
          } else if (entry.name.endsWith(".ts")) {
            files.push(full);
          }
        }
        return files;
      }

      const apiFiles = getFiles(path.join(process.cwd(), "app", "api"));
      const utilFiles = getFiles(path.join(process.cwd(), "lib", "utils"));
      const allFiles = [...apiFiles, ...utilFiles];

      const violations: string[] = [];

      for (const file of allFiles) {
        const content = fs.readFileSync(file, "utf8");

        // 1. Check for ternary error.message patterns in catch / fallback blocks
        const ternaryMatches = content.matchAll(
          /(?:const\s+\w+\s*=\s*|(?:message|error):\s*)(?:error|err|e)\s+instanceof\s+Error\s*\?\s*(?:error|err|e)\.message/g
        );
        for (const m of ternaryMatches) {
          violations.push(`${path.relative(process.cwd(), file)}: unhandled ternary error.message pattern "${m[0]}"`);
        }

        // 2. Check for raw error.message passed in generic 500 blocks without domain instanceof check
        const jsonBlocks = content.split("NextResponse.json");
        for (let i = 1; i < jsonBlocks.length; i++) {
          const prevCode = jsonBlocks[i - 1].slice(-200);
          const block = jsonBlocks[i].substring(0, jsonBlocks[i].indexOf(");"));
          if (
            (block.includes("500") || block.includes("INTERNAL_SERVER_ERROR") || block.includes("INTERNAL_ERROR")) &&
            /message:\s*(?:error|err|e)\.message/.test(block)
          ) {
            if (!/instanceof\s+[A-Z][A-Za-z0-9]+Error/.test(prevCode)) {
              violations.push(`${path.relative(process.cwd(), file)}: generic 500 block with raw error.message`);
            }
          }
        }
      }

      expect(
        violations,
        `Unsanitized error.message found in 500 / internal error blocks:\n${violations.join("\n")}`
      ).toHaveLength(0);
    });
  });
});
