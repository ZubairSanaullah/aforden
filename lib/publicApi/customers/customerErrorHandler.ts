import { ZodError } from "zod";
import { jsonError } from "@/lib/publicApi/envelope";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
    DuplicateCustomerNumberError,
    ServiceLocationPrimaryExistsError,
    InactiveCustomerError,
    InvalidCustomerError,
    CustomerDeletionNotAllowedError,
    CustomerHasProtectedReferencesError,
    ServiceLocationDeletionNotAllowedError,
    CustomerCreationError,
    CustomerUpdateError,
    ServiceLocationCreationError,
    ServiceLocationUpdateError,
} from "@/lib/services/customer/customerErrors";

/**
 * Translates Customer & ServiceLocation domain service exceptions and Zod validation errors into
 * canonical Public API error responses adhering to Section 7 of the architecture spec.
 */
export function handleCustomerPublicApiError(
    error: unknown,
    requestId?: string,
): Response {
    if (error instanceof ZodError) {
        const details = error.issues.map((issue) => ({
            field: issue.path.join("."),
            issue: issue.code.toUpperCase(),
            message: issue.message,
        }));

        return jsonError(
            "VALIDATION_ERROR",
            "The request body failed validation constraints.",
            {
                status: 422,
                details,
                requestId,
            },
        );
    }

    if (error instanceof CustomerNotFoundError) {
        return jsonError("NOT_FOUND", "Customer not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof ServiceLocationNotFoundError) {
        return jsonError("NOT_FOUND", "Service location not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof DuplicateCustomerNumberError) {
        return jsonError(
            "CONFLICT",
            "A customer with this customer number already exists in this workspace.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (error instanceof ServiceLocationPrimaryExistsError) {
        return jsonError(
            "CONFLICT",
            "A primary service location already exists for this customer.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (error instanceof InactiveCustomerError) {
        return jsonError(
            "CONFLICT",
            error.message || "Cannot perform operations for an inactive customer.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (error instanceof InvalidCustomerError) {
        return jsonError("VALIDATION_ERROR", error.message, {
            status: 422,
            requestId,
        });
    }

    if (
        error instanceof CustomerDeletionNotAllowedError ||
        error instanceof CustomerHasProtectedReferencesError ||
        error instanceof ServiceLocationDeletionNotAllowedError
    ) {
        return jsonError("CONFLICT", error.message, {
            status: 409,
            requestId,
        });
    }

    // Unhandled / server errors fall through to global envelope handler
    throw error;
}
