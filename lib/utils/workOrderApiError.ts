import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization";
import {
    WorkOrderNotFoundError,
    WorkOrderCustomerNotFoundError,
    WorkOrderCustomerInactiveError,
    WorkOrderLocationNotFoundError,
    WorkOrderTechnicianNotFoundError,
    WorkOrderTechnicianNotEligibleError,
    WorkOrderInvalidStatusTransitionError,
    WorkOrderMissingHoldReasonError,
    WorkOrderMissingCancellationReasonError,
    WorkOrderAssignmentNotAllowedError,
    WorkOrderCompletionPreconditionFailedError,
    WorkOrderCancellationNotAllowedError,
    WorkOrderImmutableError,
    WorkOrderDeletionNotAllowedError,
    DuplicateWorkOrderReferenceError,
    WorkOrderAssetCustomerMismatchError,
    WorkOrderAssetLocationMismatchError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    AssetNotFoundError,
    AssetImmutableError,
} from "@/lib/services/asset/assetErrors";
import {
    WorkTypeNotFoundError,
    WorkTypeUnavailableForWorkOrderError,
} from "@/lib/services/workType/workTypeErrors";

/**
 * Extracts the tenant workspace ID from standard request headers or query parameters.
 * Deterministic precedence:
 * 1. x-workspace-id header
 * 2. workspace-id header
 * 3. ?workspaceId= query parameter
 *
 * Empty strings and whitespace-only values are ignored.
 */
export function extractWorkspaceId(request: Request): string | null {
    const headerX = request.headers.get("x-workspace-id")?.trim();
    if (headerX) return headerX;

    const header = request.headers.get("workspace-id")?.trim();
    if (header) return header;

    try {
        const queryParam = new URL(request.url).searchParams.get("workspaceId")?.trim();
        if (queryParam) return queryParam;
    } catch {
        // Fallback for relative or malformed URLs
    }

    return null;
}

/**
 * Translates domain, validation, syntax, and authorization errors into sanitized JSON API responses.
 */
export function handleWorkOrderApiError(
    error: unknown,
    context?: string,
): NextResponse {
    // 1. Authorization errors (401 Unauthorized, 403 Forbidden / WorkspaceAccessDenied)
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) {
        return authResponse;
    }

    // 2. Validation errors (422 Unprocessable Entity)
    if (error instanceof ZodError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "VALIDATION_ERROR",
                    message: "Invalid request data.",
                    fields: error.flatten().fieldErrors,
                },
            },
            { status: 422 },
        );
    }

    // 3. JSON Syntax error (400 Bad Request)
    if (error instanceof SyntaxError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "INVALID_REQUEST",
                    message: "Invalid JSON in request body.",
                },
            },
            { status: 400 },
        );
    }

    // 4. Customer Inactive error (400 Bad Request)
    if (error instanceof WorkOrderCustomerInactiveError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_CUSTOMER_INACTIVE",
                    message: error.message,
                },
            },
            { status: 400 },
        );
    }

    // 5. Missing Hold / Cancellation Reason (400 Bad Request)
    if (error instanceof WorkOrderMissingHoldReasonError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_MISSING_HOLD_REASON",
                    message: error.message,
                },
            },
            { status: 400 },
        );
    }

    if (error instanceof WorkOrderMissingCancellationReasonError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_MISSING_CANCELLATION_REASON",
                    message: error.message,
                },
            },
            { status: 400 },
        );
    }

    // 6. Not Found errors (404 Not Found)
    if (error instanceof WorkOrderNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 },
        );
    }

    if (error instanceof WorkOrderCustomerNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_CUSTOMER_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 },
        );
    }

    if (error instanceof WorkOrderLocationNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_LOCATION_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 },
        );
    }

    if (error instanceof WorkTypeNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_TYPE_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 },
        );
    }

    if (error instanceof WorkOrderTechnicianNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_TECHNICIAN_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 },
        );
    }

    if (error instanceof AssetNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "ASSET_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 },
        );
    }

    // 7. Precondition / Unprocessable Entity errors (422)
    if (error instanceof WorkOrderAssetCustomerMismatchError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_ASSET_CUSTOMER_MISMATCH",
                    message: error.message,
                },
            },
            { status: 422 },
        );
    }

    if (error instanceof WorkOrderAssetLocationMismatchError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_ASSET_LOCATION_MISMATCH",
                    message: error.message,
                },
            },
            { status: 422 },
        );
    }

    if (error instanceof WorkOrderTechnicianNotEligibleError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_TECHNICIAN_NOT_ELIGIBLE",
                    message: error.message,
                },
            },
            { status: 422 },
        );
    }

    if (error instanceof WorkOrderCompletionPreconditionFailedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_COMPLETION_PRECONDITION_FAILED",
                    message: error.message,
                },
            },
            { status: 422 },
        );
    }

    // 8. State Conflict / Lifecycle / Immutability errors (409 Conflict)
    if (error instanceof AssetImmutableError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "ASSET_IMMUTABLE",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof WorkOrderInvalidStatusTransitionError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_INVALID_STATUS_TRANSITION",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof WorkOrderAssignmentNotAllowedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_ASSIGNMENT_NOT_ALLOWED",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof WorkOrderCancellationNotAllowedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_CANCELLATION_NOT_ALLOWED",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof WorkOrderImmutableError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_IMMUTABLE",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof WorkOrderDeletionNotAllowedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_DELETION_NOT_ALLOWED",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof DuplicateWorkOrderReferenceError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "DUPLICATE_WORK_ORDER_REFERENCE",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof WorkTypeUnavailableForWorkOrderError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_TYPE_UNAVAILABLE_FOR_WORK_ORDER",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    // 9. Fallback Unexpected Server Error (500 Internal Server Error)
    if (context) {
        console.error(`[Aforden WorkOrder API] ${context}:`, error);
    } else {
        console.error("[Aforden WorkOrder API]:", error);
    }

    return NextResponse.json(
        {
            success: false,
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "An unexpected error occurred.",
            },
        },
        { status: 500 },
    );
}
