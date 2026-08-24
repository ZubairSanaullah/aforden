import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization/authorizationResponse";
import {
    QuoteNotFoundError,
    QuoteLineItemNotFoundError,
    QuoteStatusConflictError,
    QuoteAlreadyConvertedError,
    QuoteExpiredError,
    QuoteEmptyLineItemsError,
    InvalidQuoteCalculationError,
    MissingRejectionReasonError,
} from "@/lib/services/quote/quoteErrors";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
} from "@/lib/services/customer/customerErrors";

/**
 * Extracts the tenant workspace ID from route context params, standard headers, or query parameters.
 * Deterministic precedence:
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
            query[key] = value;
        });
        return query;
    } catch {
        return {};
    }
}

/**
 * Unified error mapper for the Quotes & Estimates API route layer.
 * Maps domain errors, authorization failures, validation errors, and runtime exceptions
 * to standardized HTTP JSON error responses.
 */
export function handleQuoteApiError(
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
                    message: "Invalid request data.",
                    fields: error.flatten().fieldErrors,
                },
            },
            { status: 422 },
        );
    }

    // 3. Explicit Pure Domain Error Classes (Convention B)
    if (error instanceof QuoteNotFoundError) {
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

    if (error instanceof QuoteLineItemNotFoundError) {
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

    if (error instanceof QuoteStatusConflictError) {
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

    if (error instanceof QuoteAlreadyConvertedError) {
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

    if (error instanceof QuoteExpiredError) {
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

    if (error instanceof QuoteEmptyLineItemsError) {
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

    if (error instanceof InvalidQuoteCalculationError) {
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

    if (error instanceof MissingRejectionReasonError) {
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

    if (error instanceof CustomerNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "CUSTOMER_NOT_FOUND",
                    message: "Customer not found.",
                },
            },
            { status: 404 },
        );
    }

    if (error instanceof ServiceLocationNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "SERVICE_LOCATION_NOT_FOUND",
                    message: "Service location not found.",
                },
            },
            { status: 404 },
        );
    }

    // 4. Syntax / JSON Parsing Errors (400 Bad Request)
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

    // 5. Generic Structured Domain Errors (carrying statusCode / httpStatus and code)
    if (
        error &&
        typeof error === "object" &&
        ("statusCode" in error || "httpStatus" in error) &&
        "code" in error
    ) {
        const customError = error as {
            statusCode?: number;
            httpStatus?: number;
            code: string;
            message?: string;
        };
        const status = customError.statusCode ?? customError.httpStatus ?? 400;
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: customError.code,
                    message:
                        customError.message ||
                        "A quote domain error occurred.",
                },
            },
            { status },
        );
    }

    // 6. Internal / Unhandled Server Error (500)
    console.error(
        `[Aforden Quote API] Unexpected error${context ? ` in ${context}` : ""}:`,
        error,
    );
    return NextResponse.json(
        {
            success: false,
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message:
                    "An unexpected error occurred while processing the quote request.",
            },
        },
        { status: 500 },
    );
}

export const mapQuoteErrorToResponse = handleQuoteApiError;
