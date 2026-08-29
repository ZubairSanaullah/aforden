import { ZodError } from "zod";
import { jsonError } from "@/lib/publicApi/envelope";
import {
    AssetNotFoundError,
    AssetCustomerNotFoundError,
    AssetLocationNotFoundError,
    AssetCategoryNotFoundError,
    AssetLocationCustomerMismatchError,
    AssetLocationRequiresCustomerError,
    AssetCustomerInactiveError,
    AssetCategoryInactiveError,
    AssetImmutableError,
    AssetNumberLockedError,
    DuplicateAssetNumberError,
    AssetInvalidStatusTransitionError,
    AssetMissingStatusReasonError,
    AssetMissingTransferReasonError,
    AssetDecommissionedTransferError,
    AssetDeletionNotAllowedError,
} from "@/lib/services/asset/assetErrors";

/**
 * Translates Asset domain service exceptions and Zod validation errors into
 * canonical Public API error responses adhering to Section 7 of the architecture spec.
 */
export function handleAssetPublicApiError(
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
            "The request payload failed validation constraints.",
            {
                status: 422,
                details,
                requestId,
            },
        );
    }

    if (error instanceof AssetNotFoundError) {
        return jsonError("NOT_FOUND", "Asset not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof AssetCustomerNotFoundError) {
        return jsonError("NOT_FOUND", "Customer not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof AssetLocationNotFoundError) {
        return jsonError("NOT_FOUND", "Service location not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof AssetCategoryNotFoundError) {
        return jsonError("NOT_FOUND", "Asset category not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof AssetLocationCustomerMismatchError) {
        return jsonError(
            "VALIDATION_ERROR",
            "Specified service location does not belong to the specified customer.",
            {
                status: 422,
                requestId,
            },
        );
    }

    if (error instanceof AssetLocationRequiresCustomerError) {
        return jsonError(
            "VALIDATION_ERROR",
            "A service location cannot be assigned to an unassigned depot asset without a customer.",
            {
                status: 422,
                requestId,
            },
        );
    }

    if (error instanceof AssetCustomerInactiveError) {
        return jsonError(
            "CONFLICT",
            "Cannot assign asset to an inactive customer.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (error instanceof AssetCategoryInactiveError) {
        return jsonError(
            "CONFLICT",
            "Cannot assign asset to an inactive category.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (error instanceof AssetImmutableError) {
        return jsonError(
            "CONFLICT",
            "Asset is in a terminal state (RETIRED) and cannot be modified.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (error instanceof AssetNumberLockedError) {
        return jsonError(
            "CONFLICT",
            "Asset number cannot be modified once historical work orders exist.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (error instanceof DuplicateAssetNumberError) {
        return jsonError(
            "CONFLICT",
            "An asset with this asset number already exists in this workspace.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (error instanceof AssetInvalidStatusTransitionError) {
        return jsonError(
            "CONFLICT",
            error.message || "The requested asset status transition is not permitted.",
            {
                status: 409,
                requestId,
            },
        );
    }

    if (
        error instanceof AssetMissingStatusReasonError ||
        error instanceof AssetMissingTransferReasonError
    ) {
        return jsonError("VALIDATION_ERROR", error.message, {
            status: 422,
            requestId,
        });
    }

    if (
        error instanceof AssetDecommissionedTransferError ||
        error instanceof AssetDeletionNotAllowedError
    ) {
        return jsonError("CONFLICT", error.message, {
            status: 409,
            requestId,
        });
    }

    // Unhandled / server errors fall through to global envelope handler
    throw error;
}
