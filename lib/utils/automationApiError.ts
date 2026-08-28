import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization/authorizationResponse";
import {
  AutomationError,
  AutomationValidationError,
  AutomationRuleNotFoundError,
  AutomationExecutionNotFoundError,
  AutomationScheduleJobNotFoundError,
  AutomationTriggerNotFoundError,
  AutomationConditionGroupNotFoundError,
  AutomationActionNotFoundError,
  AutomationInvalidCronExpressionError,
  AutomationEntityOffsetResolutionError,
  AutomationRecursiveCycleDetectedError,
  AutomationMaxExecutionDepthExceededError,
  AutomationExecutionAlreadyTerminalError,
  AutomationExecutionTimeoutError,
  AutomationInvalidActionTypeError,
  AutomationActionExecutionError,
} from "@/lib/services/automation/automationErrors";
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
 * Unified error mapper for the Automation REST API route layer.
 */
export function handleAutomationApiError(
  error: unknown,
  context?: string,
): NextResponse {
  // 1. Authorization & Workspace Access Errors (401 / 403 / 404 for WorkspaceNotFound)
  const authResponse = authorizationErrorResponse(error);
  if (authResponse) {
    return authResponse;
  }

  // 2. Entitlement & Billing Errors (403 Forbidden)
  if (error instanceof PlanFeatureNotEnabledError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code || "PLAN_FEATURE_NOT_ENABLED",
          message: error.message,
          featureKey: error.featureKey,
        },
      },
      { status: 403 },
    );
  }

  if (error instanceof QuotaExceededError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code || "QUOTA_EXCEEDED",
          message: error.message,
          featureKey: error.featureKey,
        },
      },
      { status: 403 },
    );
  }

  // 3. Schema / Zod Validation Errors (400 Bad Request)
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  // 4. JSON Syntax Error
  if (error instanceof SyntaxError && error.message.includes("JSON")) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_JSON",
          message: "Invalid JSON in request body.",
        },
      },
      { status: 400 },
    );
  }

  // 5. Explicit Domain Automation Errors
  if (
    error instanceof AutomationRuleNotFoundError ||
    error instanceof AutomationExecutionNotFoundError ||
    error instanceof AutomationScheduleJobNotFoundError ||
    error instanceof AutomationTriggerNotFoundError ||
    error instanceof AutomationConditionGroupNotFoundError ||
    error instanceof AutomationActionNotFoundError
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: 404 },
    );
  }

  if (
    error instanceof AutomationInvalidCronExpressionError ||
    error instanceof AutomationValidationError ||
    error instanceof AutomationInvalidActionTypeError
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: 400 },
    );
  }

  if (
    error instanceof AutomationRecursiveCycleDetectedError ||
    error instanceof AutomationMaxExecutionDepthExceededError ||
    error instanceof AutomationEntityOffsetResolutionError
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: 422 },
    );
  }

  if (error instanceof AutomationExecutionAlreadyTerminalError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: 409 },
    );
  }


  if (error instanceof AutomationExecutionTimeoutError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: 504 },
    );
  }

  if (error instanceof AutomationActionExecutionError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: 500 },
    );
  }

  if (error instanceof AutomationError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.statusCode || 400 },
    );
  }

  // 6. Generic Sanitized 500 Internal Error
  console.error(
    `[Automation API Error] ${context ? `[${context}] ` : ""}`,
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
