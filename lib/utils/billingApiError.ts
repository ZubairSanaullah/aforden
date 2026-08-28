import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization/authorizationResponse";
import {
  PlanFeatureNotEnabledError,
  QuotaExceededError,
  DuplicateActiveSubscriptionError,
  SubscriptionPastDueError,
  InvalidSubscriptionStateTransitionError,
  WebhookVerificationError,
  InvalidEntitlementMultiplierError,
  BillingAccountNotFoundError,
  PlanNotFoundError,
  PlanPriceNotFoundError,
  SubscriptionNotFoundError,
  InvalidSubscriptionStatusForPlanChangeError,
  DowngradeUsageExceededError,
  MissingProviderCustomerError,
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
 * Unified error mapper for the SaaS Billing REST API route layer.
 */
export function handleBillingApiError(
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

  // 4. Pure Domain Error Classes
  if (
    error instanceof PlanFeatureNotEnabledError ||
    error instanceof QuotaExceededError ||
    error instanceof DuplicateActiveSubscriptionError ||
    error instanceof SubscriptionPastDueError ||
    error instanceof InvalidSubscriptionStateTransitionError ||
    error instanceof WebhookVerificationError ||
    error instanceof InvalidEntitlementMultiplierError ||
    error instanceof BillingAccountNotFoundError ||
    error instanceof PlanNotFoundError ||
    error instanceof PlanPriceNotFoundError ||
    error instanceof SubscriptionNotFoundError ||
    error instanceof InvalidSubscriptionStatusForPlanChangeError ||
    error instanceof DowngradeUsageExceededError ||
    error instanceof MissingProviderCustomerError
  ) {

    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          context: error.context,
        },
      },
      { status: error.statusCode },
    );
  }

  // 5. Generic duck-typing for custom domain errors
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
          context: (error as any).context,
        },
      },
      { status: (error as any).statusCode },
    );
  }

  // 6. Unhandled / Unexpected Errors (500 Internal Server Error — sanitizing internals)
  console.error(
    `[Billing API Error] ${context ? `[${context}] ` : ""}`,
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
