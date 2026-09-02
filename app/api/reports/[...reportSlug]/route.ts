import { NextResponse } from "next/server";
import { composeReport } from "@/lib/services/reporting/reportEngine";
import { createReportCsvStream } from "@/lib/services/reporting/csvSerializer";
import { REPORT_KEYS } from "@/lib/services/reporting/reporting.schemas";
import { ReportNotFoundError } from "@/lib/services/reporting/reportingErrors";
import {
  extractQueryParams,
  handleReportingApiError,
  resolveWorkspaceId,
} from "@/lib/utils/reportingApiError";
import type { ReportKey } from "@/lib/services/reporting/reporting.types";
import { prisma } from "@/lib/prisma";
import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { getReportDefinition } from "@/lib/services/reporting/reportRegistry";
import { assertPermission } from "@/lib/services/authorization/permissionService";

/**
 * Report keys that require the FEATURE_ADVANCED_REPORTING entitlement.
 * Covers: financial analytics (revenue, AR aging, quote conversion/pipeline) and
 * technician efficiency reports (productivity scorecard, self-scorecard).
 * Operational, scheduling, asset, inventory, and customer activity reports
 * remain available to all non-terminal subscriptions and free-tier workspaces.
 */
const ADVANCED_REPORT_KEYS = new Set<ReportKey>([
  "financial.revenueSummary",
  "financial.arAging",
  "financial.quoteConversion",
  "financial.quotePipeline",
  "technician.productivity",
  "technician.selfScorecard",
] as ReportKey[]);

/**
 * Maps dynamic URL slug segments (kebab-case or dot-notation) to canonical closed ReportKey.
 */
function resolveSlugToReportKey(slugSegments: string[]): ReportKey {
  if (!slugSegments || slugSegments.length === 0) {
    throw new ReportNotFoundError("Report route slug is required.");
  }

  // 1. Exact dot notation match (e.g. ["operational.workOrderVolume"])
  const dotNotation = slugSegments.join(".");
  if (REPORT_KEYS.includes(dotNotation as ReportKey)) {
    return dotNotation as ReportKey;
  }

  // 2. Kebab-case URL path map (e.g. ["operational", "work-order-volume"])
  const slugPath = slugSegments.join("/");
  const slugMap: Record<string, ReportKey> = {
    "operational/work-order-volume": "operational.workOrderVolume",
    "operational/workOrderVolume": "operational.workOrderVolume",
    "operational/work-order-throughput": "operational.workOrderThroughput",
    "operational/workOrderThroughput": "operational.workOrderThroughput",
    "scheduling/dispatch-performance": "scheduling.dispatchPerformance",
    "scheduling/dispatchPerformance": "scheduling.dispatchPerformance",
    "technician/productivity": "technician.productivity",
    "technician/self-scorecard": "technician.selfScorecard",
    "technician/selfScorecard": "technician.selfScorecard",
    "financial/revenue-summary": "financial.revenueSummary",
    "financial/revenueSummary": "financial.revenueSummary",
    "financial/ar-aging": "financial.arAging",
    "financial/arAging": "financial.arAging",
    "financial/quote-conversion": "financial.quoteConversion",
    "financial/quoteConversion": "financial.quoteConversion",
    "financial/quote-pipeline": "financial.quotePipeline" as ReportKey,
    "financial/quotePipeline": "financial.quotePipeline" as ReportKey,
    "inventory/parts-consumption": "inventory.partsConsumption",
    "inventory/partsConsumption": "inventory.partsConsumption",
    "asset/summary": "asset.summary",
    "customer/activity-summary": "customer.activitySummary",
    "customer/activitySummary": "customer.activitySummary",
  };

  const resolved = slugMap[slugPath];
  if (resolved) {
    return resolved;
  }

  throw new ReportNotFoundError(`Unknown or unsupported report path: "${slugPath}".`);
}

/**
 * GET /api/reports/[...reportSlug]
 *
 * Executes the requested domain report over HTTP with full RBAC, tenant isolation,
 * Zod validation, live aggregation, and optional CSV export.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ reportSlug: string[] }> | { reportSlug: string[] } },
) {
  try {
    // 1. Resolve Workspace Tenancy Header / Query
    const workspaceRes = resolveWorkspaceId(request);
    if (workspaceRes.errorResponse) {
      return workspaceRes.errorResponse;
    }
    const workspaceId = workspaceRes.workspaceId;

    // 2. Resolve Dynamic Route Slug
    const resolvedParams =
      context.params instanceof Promise ? await context.params : context.params;
    const reportKey = resolveSlugToReportKey(resolvedParams.reportSlug);

    // 3. Authenticate and Authorize Workspace Access & Role RBAC
    const auth = await requireWorkspaceAuthorization(workspaceId);
    const definition = getReportDefinition(reportKey);
    assertPermission(auth.membership.role, definition.requiredPermission);

    // 4. Extract and Validate Query Parameters
    const queryParams = extractQueryParams(request);

    // 5. Phase 1.15.5: Feature gate — assert FEATURE_ADVANCED_REPORTING for gated reports.
    // Plan entitlement check executes after user RBAC authorization, ensuring unauthorized
    // roles receive 403 FORBIDDEN without probing tenant subscription tier status.
    if (ADVANCED_REPORT_KEYS.has(reportKey)) {
      await assertEntitlement(prisma, workspaceId, "FEATURE_ADVANCED_REPORTING");
    }

    // 6. Execute live report aggregation via composition engine
    const reportResponse = await composeReport(reportKey, workspaceId, queryParams, auth);

    // 6. Handle CSV Export Response
    const wantsCsv =
      queryParams.format === "csv" ||
      request.headers.get("accept")?.includes("text/csv");

    if (wantsCsv) {
      const stream = createReportCsvStream(reportResponse);
      const filename = `${reportKey.replace(".", "-")}.csv`;

      return new NextResponse(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Transfer-Encoding": "chunked",
        },
      });
    }

    // 7. Return Standard JSON Response
    return NextResponse.json(
      {
        success: true,
        data: reportResponse,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleReportingApiError(error, "Report REST Route");
  }
}
