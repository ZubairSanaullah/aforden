import { NextResponse } from "next/server";
import { composeReport } from "@/lib/services/reporting/reportEngine";
import { serializeReportToCsv } from "@/lib/services/reporting/csvSerializer";
import { REPORT_KEYS } from "@/lib/services/reporting/reporting.schemas";
import { ReportNotFoundError } from "@/lib/services/reporting/reportingErrors";
import {
  extractQueryParams,
  handleReportingApiError,
  resolveWorkspaceId,
} from "@/lib/utils/reportingApiError";
import type { ReportKey } from "@/lib/services/reporting/reporting.types";

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

    // 3. Extract and Validate Query Parameters
    const queryParams = extractQueryParams(request);

    // 4. Execute live report aggregation via composition engine
    const reportResponse = await composeReport(reportKey, workspaceId, queryParams);

    // 5. Handle CSV Export Response
    const wantsCsv =
      queryParams.format === "csv" ||
      request.headers.get("accept")?.includes("text/csv");

    if (wantsCsv) {
      const csvData = serializeReportToCsv(reportResponse);
      const filename = `${reportKey.replace(".", "-")}.csv`;

      return new NextResponse(csvData, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // 6. Return Standard JSON Response
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
