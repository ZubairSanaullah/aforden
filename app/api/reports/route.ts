import { NextResponse } from "next/server";
import { composeReport } from "@/lib/services/reporting/reportEngine";
import { serializeReportToCsv } from "@/lib/services/reporting/csvSerializer";
import { REPORT_REGISTRY } from "@/lib/services/reporting/reportRegistry";
import { REPORT_KEYS } from "@/lib/services/reporting/reporting.schemas";
import {
  extractQueryParams,
  handleReportingApiError,
  resolveWorkspaceId,
} from "@/lib/utils/reportingApiError";
import type { ReportKey } from "@/lib/services/reporting/reporting.types";

/**
 * GET /api/reports
 *
 * If `reportKey` query param is supplied, executes that report.
 * Otherwise, lists all registered report definitions and capabilities.
 */
export async function GET(request: Request) {
  try {
    const workspaceRes = resolveWorkspaceId(request);
    if (workspaceRes.errorResponse) {
      return workspaceRes.errorResponse;
    }
    const workspaceId = workspaceRes.workspaceId;

    const queryParams = extractQueryParams(request);

    // 1. If reportKey parameter is present, execute that report
    if (queryParams.reportKey) {
      const reportKey = queryParams.reportKey as ReportKey;
      const reportResponse = await composeReport(reportKey, workspaceId, queryParams);

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

      return NextResponse.json(
        {
          success: true,
          data: reportResponse,
        },
        { status: 200 },
      );
    }

    // 2. Otherwise return report catalog metadata
    const catalog = Object.values(REPORT_REGISTRY).map((def) => ({
      reportKey: def.reportKey,
      title: def.title,
      category: def.category,
      description: def.description,
      metrics: def.metrics,
      allowedDimensions: def.allowedDimensions,
      allowedFilters: def.allowedFilters,
      supportsTimeSeries: def.supportsTimeSeries,
      supportsCsvExport: def.supportsCsvExport,
      requiredPermission: def.requiredPermission,
    }));

    return NextResponse.json(
      {
        success: true,
        data: catalog,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleReportingApiError(error, "Report Catalog/Execution Route");
  }
}
