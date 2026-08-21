import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization";
import {
    AssetNotFoundError,
    AssetCustomerNotFoundError,
    AssetCustomerInactiveError,
    AssetLocationNotFoundError,
    AssetLocationCustomerMismatchError,
    AssetLocationRequiresCustomerError,
    AssetCategoryNotFoundError,
    AssetCategoryInactiveError,
    AssetInvalidStatusTransitionError,
    AssetMissingStatusReasonError,
    AssetMissingTransferReasonError,
    AssetImmutableError,
    AssetNumberLockedError,
    AssetDecommissionedTransferError,
    AssetDeletionNotAllowedError,
    DuplicateAssetNumberError,
} from "@/lib/services/asset/assetErrors";
import {
    AssetCategoryAlreadyExistsError,
    AssetCategoryDeletionNotAllowedError,
} from "@/lib/services/assetCategory/assetCategoryErrors";

/**
 * Extracts the tenant workspace ID from standard request headers or query parameters.
 * Precedence:
 * 1. x-workspace-id header
 * 2. workspace-id header
 * 3. ?workspaceId= query parameter
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
export function handleAssetApiError(
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

    // 4. Specific 400 Bad Request domain errors
    if (
        error instanceof AssetCustomerInactiveError ||
        error instanceof AssetCategoryInactiveError
    ) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: (error as any).code || "BAD_REQUEST",
                    message: (error as any).message,
                },
            },
            { status: (error as any).statusCode || 400 },
        );
    }

    // 5. Specific 422 Unprocessable Entity domain errors
    if (
        error instanceof AssetMissingStatusReasonError ||
        error instanceof AssetMissingTransferReasonError ||
        error instanceof AssetLocationCustomerMismatchError ||
        error instanceof AssetLocationRequiresCustomerError
    ) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: (error as any).code || "UNPROCESSABLE_ENTITY",
                    message: (error as any).message,
                },
            },
            { status: 422 },
        );
    }

    // 6. Specific 404 Not Found domain errors
    if (
        error instanceof AssetNotFoundError ||
        error instanceof AssetCustomerNotFoundError ||
        error instanceof AssetLocationNotFoundError ||
        error instanceof AssetCategoryNotFoundError
    ) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: (error as any).code || "NOT_FOUND",
                    message: (error as any).message,
                },
            },
            { status: 404 },
        );
    }

    // 7. Specific 409 Conflict domain errors
    if (
        error instanceof AssetInvalidStatusTransitionError ||
        error instanceof AssetImmutableError ||
        error instanceof AssetNumberLockedError ||
        error instanceof AssetDecommissionedTransferError ||
        error instanceof AssetDeletionNotAllowedError ||
        error instanceof DuplicateAssetNumberError ||
        error instanceof AssetCategoryAlreadyExistsError ||
        error instanceof AssetCategoryDeletionNotAllowedError
    ) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: (error as any).code || "CONFLICT",
                    message: (error as any).message,
                },
            },
            { status: 409 },
        );
    }

    // 8. Generic mapped domain errors with statusCode
    if (
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        "code" in error &&
        typeof (error as any).statusCode === "number"
    ) {
        const statusCode = (error as any).statusCode;
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: (error as any).code,
                    message: (error as any).message || "An application error occurred.",
                },
            },
            { status: statusCode },
        );
    }

    // 9. Unhandled internal error fallback (sanitized 500)
    console.error(`[Asset API Error] ${context ? `[${context}] ` : ""}`, error);
    return NextResponse.json(
        {
            success: false,
            error: {
                code: "INTERNAL_ERROR",
                message: "An unexpected error occurred.",
            },
        },
        { status: 500 },
    );
}
