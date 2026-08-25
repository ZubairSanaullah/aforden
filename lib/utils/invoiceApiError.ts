import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization/authorizationResponse";
import {
    InvoiceNotFoundError,
    InvoiceLineItemNotFoundError,
    PaymentNotFoundError,
    InvoiceStatusConflictError,
    InvoiceAlreadyPaidError,
    InvoiceAlreadyVoidedError,
    PaymentAlreadyVoidedError,
    InvoiceHasActivePaymentsError,
    InvoiceTotalsMismatchError,
    OverpaymentNotAllowedError,
    InvalidPaymentAmountError,
    InvoiceEmptyLineItemsError,
    InvalidInvoiceCalculationError,
    SourceEntityNotEligibleError,
    MissingVoidReasonError,
    InvoiceDueDateInvalidError,
} from "@/lib/services/invoice/invoiceErrors";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
} from "@/lib/services/customer/customerErrors";
import { QuoteNotFoundError } from "@/lib/services/quote/quoteErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";

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
            query[key] = value;
        });
        return query;
    } catch {
        return {};
    }
}

/**
 * Unified error mapper for the Invoicing & Payments API route layer.
 * Maps domain errors, authorization failures, validation errors, and runtime exceptions
 * to standardized HTTP JSON error responses.
 */
export function handleInvoiceApiError(
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

    // 3. Malformed JSON Body (400 Bad Request)
    if (error instanceof SyntaxError && (error.message.includes("JSON") || error.name === "SyntaxError")) {
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

    // 4. Cross-Domain Entity Not Found Errors (Convention A: simple subclasses)
    if (error instanceof CustomerNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "CUSTOMER_NOT_FOUND",
                    message: error.message,
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
                    message: error.message,
                },
            },
            { status: 404 },
        );
    }

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

    if (error instanceof QuoteNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "QUOTE_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 },
        );
    }

    // 5. Invoicing Pure Domain Error Classes (Convention B: statusCode / code metadata)
    if (
        error instanceof InvoiceNotFoundError ||
        error instanceof InvoiceLineItemNotFoundError ||
        error instanceof PaymentNotFoundError ||
        error instanceof InvoiceStatusConflictError ||
        error instanceof InvoiceAlreadyPaidError ||
        error instanceof InvoiceAlreadyVoidedError ||
        error instanceof PaymentAlreadyVoidedError ||
        error instanceof InvoiceHasActivePaymentsError ||
        error instanceof InvoiceTotalsMismatchError ||
        error instanceof OverpaymentNotAllowedError ||
        error instanceof InvalidPaymentAmountError ||
        error instanceof InvoiceEmptyLineItemsError ||
        error instanceof InvalidInvoiceCalculationError ||
        error instanceof SourceEntityNotEligibleError ||
        error instanceof MissingVoidReasonError ||
        error instanceof InvoiceDueDateInvalidError
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

    // Generic duck-typing for custom domain errors
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

    // 6. Unhandled / Unexpected Errors (500 Internal Server Error — sanitizing internals)
    console.error(
        `[Invoice API Error] ${context ? `[${context}] ` : ""}`,
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
