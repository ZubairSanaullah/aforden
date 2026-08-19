import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization";
import {
    CustomerNotFoundError,
    CustomerContactNotFoundError,
    InactiveCustomerError,
    CustomerContactPrimaryExistsError,
    CustomerContactDeletionNotAllowedError,
} from "@/lib/services/customer/customerErrors";

/**
 * Translates domain, validation, and authorization errors into consistent JSON API error responses.
 */
export function handleCustomerContactApiError(
    error: unknown,
    context?: string,
): NextResponse {
    // 1. Authorization errors (401, 403)
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) {
        return authResponse;
    }

    // 2. Validation errors (422)
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

    // 3. JSON Syntax error (400)
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

    // 4. Inactive Customer error (400)
    if (error instanceof InactiveCustomerError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "INACTIVE_CUSTOMER",
                    message: error.message || "Cannot perform operations on contacts for an inactive customer.",
                },
            },
            { status: 400 },
        );
    }

    // 5. Customer Not Found (404)
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

    // 6. Contact Not Found (404)
    if (error instanceof CustomerContactNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "CONTACT_NOT_FOUND",
                    message: "Customer contact not found.",
                },
            },
            { status: 404 },
        );
    }

    // 7. Primary Contact Exists Conflict (409)
    if (error instanceof CustomerContactPrimaryExistsError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "PRIMARY_CONTACT_EXISTS",
                    message: error.message || "A primary contact already exists for this customer.",
                },
            },
            { status: 409 },
        );
    }

    // 8. Contact Deletion Not Allowed Conflict (409)
    if (error instanceof CustomerContactDeletionNotAllowedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "DELETION_NOT_ALLOWED",
                    message: error.message || "Customer contact deletion is not permitted because protected references exist.",
                },
            },
            { status: 409 },
        );
    }

    // 9. Fallback Unexpected Internal Error (500)
    if (context) {
        console.error(`[Aforden Customer API] ${context}:`, error);
    } else {
        console.error("[Aforden Customer API]:", error);
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
