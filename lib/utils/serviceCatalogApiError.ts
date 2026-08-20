import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization";
import {
    ServiceCatalogNotFoundError,
    DuplicateServiceCatalogNameError,
    ServiceCatalogDeletionNotAllowedError,
    InactiveServiceCatalogError,
} from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import {
    WorkTypeNotFoundError,
    DuplicateWorkTypeNameError,
    DuplicateWorkTypeCodeError,
    WorkTypeDeletionNotAllowedError,
    InvalidWorkTypeDurationError,
    WorkTypeUnavailableForWorkOrderError,
} from "@/lib/services/workType/workTypeErrors";


/**
 * Extracts the tenant workspace ID from standard request headers or query parameters.
 */
export function extractWorkspaceId(request: Request): string | null {
    return (
        request.headers.get("x-workspace-id") ||
        request.headers.get("workspace-id") ||
        new URL(request.url).searchParams.get("workspaceId") ||
        null
    );
}

/**
 * Translates domain, validation, syntax, and authorization errors into sanitized JSON API responses.
 */
export function handleServiceCatalogApiError(
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

    // 4. Invalid WorkType Duration error (422 Unprocessable Entity)
    if (error instanceof InvalidWorkTypeDurationError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "INVALID_WORK_TYPE_DURATION",
                    message: error.message,
                },
            },
            { status: 422 },
        );
    }

    // 5. Inactive Service Catalog error (400 Bad Request)
    if (error instanceof InactiveServiceCatalogError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "INACTIVE_SERVICE_CATALOG",
                    message: error.message,
                },
            },
            { status: 400 },
        );
    }

    // 6. Not Found errors (404 Not Found)
    if (error instanceof ServiceCatalogNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "SERVICE_CATALOG_NOT_FOUND",
                    message: "Service catalog not found.",
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
                    message: "Work type not found.",
                },
            },
            { status: 404 },
        );
    }

    // 7. Duplicate / Conflict errors (409 Conflict)
    if (error instanceof DuplicateServiceCatalogNameError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "DUPLICATE_SERVICE_CATALOG_NAME",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof DuplicateWorkTypeNameError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "DUPLICATE_WORK_TYPE_NAME",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof DuplicateWorkTypeCodeError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "DUPLICATE_WORK_TYPE_CODE",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    // 8. Deletion restriction errors (409 Conflict)
    if (error instanceof ServiceCatalogDeletionNotAllowedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "SERVICE_CATALOG_DELETION_NOT_ALLOWED",
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof WorkTypeDeletionNotAllowedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_TYPE_DELETION_NOT_ALLOWED",
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
        console.error(`[Aforden Service Catalog API] ${context}:`, error);
    } else {
        console.error("[Aforden Service Catalog API]:", error);
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
