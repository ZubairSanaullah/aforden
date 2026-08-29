import { ZodError } from "zod";
import { jsonError } from "@/lib/publicApi/envelope";
import {
    WorkOrderNotFoundError,
    WorkOrderCustomerNotFoundError,
    WorkOrderCustomerInactiveError,
    WorkOrderLocationNotFoundError,
    WorkOrderAssetCustomerMismatchError,
    WorkOrderAssetLocationMismatchError,
    WorkOrderImmutableError,
    DuplicateWorkOrderReferenceError,
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
 * Translates domain service exceptions and Zod validation errors into
 * canonical Public API error responses adhering to Section 7 of the architecture spec.
 */
export function handleWorkOrderPublicApiError(
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

    if (error instanceof WorkOrderNotFoundError) {
        return jsonError("NOT_FOUND", "Work order not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof WorkOrderCustomerNotFoundError) {
        return jsonError("NOT_FOUND", "Customer not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof WorkOrderLocationNotFoundError) {
        return jsonError("NOT_FOUND", "Service location not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof WorkTypeNotFoundError) {
        return jsonError("NOT_FOUND", "Work type not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof AssetNotFoundError) {
        return jsonError("NOT_FOUND", "Asset not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof WorkOrderCustomerInactiveError) {
        return jsonError(
            "VALIDATION_ERROR",
            "Customer is inactive and cannot accept new work orders.",
            {
                status: 422,
                requestId,
            },
        );
    }

    if (error instanceof WorkTypeUnavailableForWorkOrderError) {
        return jsonError(
            "VALIDATION_ERROR",
            "Work type is unavailable for new work orders.",
            {
                status: 422,
                requestId,
            },
        );
    }

    if (error instanceof WorkOrderAssetCustomerMismatchError) {
        return jsonError(
            "VALIDATION_ERROR",
            "Asset does not belong to specified customer.",
            {
                status: 422,
                requestId,
            },
        );
    }

    if (error instanceof WorkOrderAssetLocationMismatchError) {
        return jsonError(
            "VALIDATION_ERROR",
            "Asset does not belong to specified service location.",
            {
                status: 422,
                requestId,
            },
        );
    }

    if (error instanceof WorkOrderImmutableError) {
        return jsonError(
            "CONFLICT",
            "Work order is in a terminal state and cannot be updated.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (error instanceof AssetImmutableError) {
        return jsonError(
            "CONFLICT",
            "Asset is retired and cannot be assigned to work orders.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (error instanceof DuplicateWorkOrderReferenceError) {
        return jsonError(
            "CONFLICT",
            "A work order with this reference number already exists.",
            {
                status: 409,
                requestId,
            },
        );
    }

    // Re-throw unknown errors for top-level 500 handler sanitization
    throw error;
}
