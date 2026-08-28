import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization/authorizationResponse";
import {
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
} from "@/lib/services/reporting/reportingErrors";
import {
  PlanFeatureNotEnabledError,
  QuotaExceededError,
} from "@/lib/services/billing/billingErrors";

/**
 * Extracts the tenant workspace ID from route context params, standard headers, or query parameters.
 * Precedence:
 * 1. Path param (from context.params.workspaceId)
 * 2. x-workspace-id header
 * 3. workspace-id header
 * 4. ?workspaceId= query parameter
 */
export function extractWorkspaceId(
  request: Request,
  pathWorkspaceId?: string,
): string | null {
  if (pathWorkspaceId && pathWorkspaceId.trim().length > 0) {
    return pathWorkspaceId.trim();
  }

  const headerX = request.headers.get("x-workspace-id")?.trim();
  if (headerX) return headerX;

  const header = request.headers.get("workspace-id")?.trim();
  if (header) return header;

  try {
    const queryParam = new URL(request.url).searchParams
      .get("workspaceId")
      ?.trim();
    if (queryParam) return queryParam;
  } catch {
    // Fallback for relative or malformed URLs
  }

  return null;
}

/**
 * Resolves the tenant workspace ID or returns a standardized 400 MISSING_WORKSPACE response.
 */
export function resolveWorkspaceId(
  request: Request,
  pathWorkspaceId?: string,
):
  | { workspaceId: string; errorResponse?: never }
  | { workspaceId?: never; errorResponse: NextResponse } {
  const workspaceId = extractWorkspaceId(request, pathWorkspaceId);
  if (!workspaceId) {
    return {
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_WORKSPACE",
            message: "Workspace ID is required.",
          },
        },
        { status: 400 },
      ),
    };
  }
  return { workspaceId };
}

/**
 * Extracts URL search parameters as a plain Record<string, any> object for service-layer Zod parsing.
 */
export function extractQueryParams(request: Request): Record<string, any> {
  try {
    const { searchParams } = new URL(request.url);
    const query: Record<string, any> = {};
    searchParams.forEach((value, key) => {
      // Handle repeated keys or comma-separated lists if needed
      if (query[key] !== undefined) {
        if (Array.isArray(query[key])) {
          query[key].push(value);
        } else {
          query[key] = [query[key], value];
        }
      } else {
        query[key] = value;
      }
    });
    return query;
  } catch {
    return {};
  }
}

/**
 * Unified error mapper for the Reporting & Analytics API route layer.
 * Maps domain errors, authorization failures, validation errors, and runtime exceptions
 * to standardized HTTP JSON error responses.
 */
export function handleReportingApiError(
  error: unknown,
  context?: string,
): NextResponse {
  // 1. Authorization & Workspace Access Errors (401 / 403 / 404 for WorkspaceNotFound)
  const authResponse = authorizationErrorResponse(error);
  if (authResponse) {
    return authResponse;
  }

  // 2. Schema / Validation Errors (422 Unprocessable Entity)
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request parameters.",
          fields: error.flatten().fieldErrors,
        },
      },
      { status: 422 },
    );
  }

  // 3. Malformed JSON Body (400 Bad Request)
  if (
    error instanceof SyntaxError &&
    (error.message.includes("JSON") || error.name === "SyntaxError")
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MALFORMED_JSON",
          message: "Malformed JSON in request body.",
        },
      },
      { status: 400 },
    );
  }

  // 4. Billing Entitlement Errors (Phase 1.15.5)
  // PlanFeatureNotEnabledError — feature gated (403 Forbidden)
  // QuotaExceededError — resource quota reached (402 Payment Required)
  if (error instanceof PlanFeatureNotEnabledError || error instanceof QuotaExceededError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.statusCode },
    );
  }

  // 5. Reporting Pure Domain Error Classes (Convention B: statusCode / code metadata)
  if (
    error instanceof ReportNotFoundError ||
    error instanceof UnknownMetricError ||
    error instanceof UnknownDimensionError ||
    error instanceof UnknownFilterError ||
    error instanceof UnsupportedMetricDimensionCombinationError ||
    error instanceof InvalidReportDateRangeError ||
    error instanceof ReportDateRangeTooLargeError ||
    error instanceof ReportCardinalityExceededError ||
    error instanceof ReportExportTooLargeError ||
    error instanceof ReportScopeViolationError ||
    error instanceof ReportingIdentifierViolationError ||
    error instanceof ReportMetricUnavailableError
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.statusCode },
    );
  }

  // 6. Generic duck-typing for custom domain errors
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "statusCode" in error &&
    "message" in error &&
    typeof (error as any).statusCode === "number"
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: String((error as any).code),
          message: String((error as any).message),
        },
      },
      { status: (error as any).statusCode },
    );
  }

  // 7. Unhandled / Unexpected Errors (500 Internal Server Error — sanitizing internals)
  console.error(
    `[Reporting API Error] ${context ? `[${context}] ` : ""}`,
    error,
  );

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred. Please try again later.",
      },
    },
    { status: 500 },
  );
}
