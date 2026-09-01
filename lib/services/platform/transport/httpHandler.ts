import { NextResponse, NextRequest } from "next/server";
import {
    PlatformAuthorizationContext,
    PlatformPermission,
    requirePlatformAuthorization,
    PLATFORM_ROLE_PERMISSIONS,
} from "@/lib/services/platform/authorization";
import {
    PlatformUnauthorizedError,
    PlatformAccessDeniedError,
    PlatformAdminInactiveError,
    PlatformSessionExpiredError,
} from "@/lib/services/platform/authorization/platformErrors";
import {
    PlatformWorkspaceNotFoundError,
    PlatformActionValidationError,
    PlatformWorkspaceConflictError,
} from "@/lib/services/platform/workspaces/errors";
import { PlatformWorkspaceSupportNotFoundError } from "@/lib/services/platform/support/errors";
import {
    PlatformOperatorNotFoundError,
    PlatformOperatorValidationError,
    PlatformOperatorConflictError,
    PlatformLastOwnerProtectionError,
    PlatformSelfModificationError,
} from "@/lib/services/platform/operators/errors";
import {
    PlatformFeatureFlagNotFoundError,
    PlatformFeatureFlagValidationError,
    PlatformFeatureFlagConflictError,
} from "@/lib/services/platform/flags/errors";
import {
    PlatformRuntimeSettingNotFoundError,
    PlatformRuntimeSettingValidationError,
} from "@/lib/services/platform/settings/errors";
import {
    PlatformDeveloperApplicationNotFoundError,
    PlatformApiKeyNotFoundError,
    PlatformWebhookEndpointNotFoundError,
    PlatformDeveloperValidationError,
    PlatformDeveloperConflictError,
} from "@/lib/services/platform/developer/errors";
import {
    PlatformIntegrationNotFoundError,
    PlatformIntegrationConnectionNotFoundError,
    PlatformIntegrationCredentialNotFoundError,
    PlatformIntegrationValidationError,
} from "@/lib/services/platform/integrations/errors";
import {
    PlatformBillingAccountNotFoundError,
    PlatformSubscriptionPlanNotFoundError,
    PlatformSubscriptionNotFoundError,
    PlatformEntitlementOverrideNotFoundError,
    PlatformBillingWebhookNotFoundError,
    PlatformBillingValidationError,
    PlatformBillingConflictError,
} from "@/lib/services/platform/billing/errors";
import { PlatformHealthError } from "@/lib/services/platform/health/errors";
import { PlatformStepUpAuthenticationRequiredError } from "@/lib/services/platform/authorization";
import { PlatformStepUpChallengeFailedError } from "@/lib/services/platform/security";

export { PlatformStepUpAuthenticationRequiredError, PlatformStepUpChallengeFailedError };

/**
 * Standardized success response envelope for Platform Administration APIs.
 */
export function jsonSuccess<T>(data: T, status: number = 200): NextResponse {
    return NextResponse.json(
        {
            success: true,
            data,
        },
        { status }
    );
}

/**
 * Standardized error response envelope for Platform Administration APIs.
 */
export function jsonError(
    message: string,
    status: number,
    code: string = "PLATFORM_ERROR",
    details?: unknown
): NextResponse {
    return NextResponse.json(
        {
            success: false,
            error: {
                code,
                message,
                ...(details ? { details } : {}),
            },
        },
        { status }
    );
}

/**
 * Centralized error-to-HTTP mapping for all platform domain services.
 */
export function handlePlatformError(error: unknown): NextResponse {
    // 401 Unauthorized / Session Expired
    if (error instanceof PlatformUnauthorizedError) {
        return jsonError(error.message || "Authentication required.", 401, "UNAUTHORIZED");
    }
    if (error instanceof PlatformSessionExpiredError) {
        return jsonError(
            error.message || "Platform session expired due to inactivity. Please sign in again.",
            401,
            "SESSION_EXPIRED"
        );
    }

    // 403 Forbidden / Uniform Access Denied (Enumeration-Resistant)
    if (error instanceof PlatformAccessDeniedError) {
        return jsonError("Access denied.", 403, "FORBIDDEN");
    }
    if (error instanceof PlatformAdminInactiveError) {
        return jsonError(
            "Platform operator profile is inactive.",
            403,
            "OPERATOR_INACTIVE"
        );
    }
    if (error instanceof PlatformSelfModificationError) {
        return jsonError(
            error.message,
            403,
            error.code || "SELF_MODIFICATION_PROHIBITED"
        );
    }

    // Step-up authentication required (Tier-2 actions)
    if (error instanceof PlatformStepUpAuthenticationRequiredError) {
        return jsonError(
            error.message,
            403,
            "STEP_UP_REQUIRED"
        );
    }
    if (error instanceof PlatformStepUpChallengeFailedError) {
        return jsonError(
            error.message,
            403,
            "STEP_UP_CHALLENGE_FAILED"
        );
    }

    // 400 Bad Request / Validation Errors
    if (
        error instanceof PlatformActionValidationError ||
        error instanceof PlatformOperatorValidationError ||
        error instanceof PlatformFeatureFlagValidationError ||
        error instanceof PlatformRuntimeSettingValidationError ||
        error instanceof PlatformDeveloperValidationError ||
        error instanceof PlatformIntegrationValidationError ||
        error instanceof PlatformBillingValidationError
    ) {
        const err = error as Error & { code?: string };
        return jsonError(
            err.message,
            400,
            err.code || "VALIDATION_ERROR"
        );
    }

    // 404 Not Found
    if (
        error instanceof PlatformWorkspaceNotFoundError ||
        error instanceof PlatformWorkspaceSupportNotFoundError ||
        error instanceof PlatformOperatorNotFoundError ||
        error instanceof PlatformFeatureFlagNotFoundError ||
        error instanceof PlatformRuntimeSettingNotFoundError ||
        error instanceof PlatformDeveloperApplicationNotFoundError ||
        error instanceof PlatformApiKeyNotFoundError ||
        error instanceof PlatformWebhookEndpointNotFoundError ||
        error instanceof PlatformIntegrationNotFoundError ||
        error instanceof PlatformIntegrationConnectionNotFoundError ||
        error instanceof PlatformIntegrationCredentialNotFoundError ||
        error instanceof PlatformBillingAccountNotFoundError ||
        error instanceof PlatformSubscriptionPlanNotFoundError ||
        error instanceof PlatformSubscriptionNotFoundError ||
        error instanceof PlatformEntitlementOverrideNotFoundError ||
        error instanceof PlatformBillingWebhookNotFoundError
    ) {
        const err = error as Error & { code?: string };
        return jsonError(
            err.message,
            404,
            err.code || "NOT_FOUND"
        );
    }

    // 409 Conflict
    if (
        error instanceof PlatformWorkspaceConflictError ||
        error instanceof PlatformOperatorConflictError ||
        error instanceof PlatformLastOwnerProtectionError ||
        error instanceof PlatformFeatureFlagConflictError ||
        error instanceof PlatformDeveloperConflictError ||
        error instanceof PlatformBillingConflictError
    ) {
        const err = error as Error & { code?: string };
        return jsonError(
            err.message,
            409,
            err.code || "CONFLICT"
        );
    }

    // 500 Internal / Subsystem Health Error
    if (error instanceof PlatformHealthError) {
        return jsonError(
            error.message,
            500,
            error.code || "PLATFORM_HEALTH_ERROR"
        );
    }

    // Generic fallback: check if error object specifies statusCode & code
    if (
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        typeof (error as { statusCode: unknown }).statusCode === "number"
    ) {
        const err = error as Error & { statusCode: number; code?: string };
        return jsonError(err.message, err.statusCode, err.code || "PLATFORM_ERROR");
    }

    // Generic fallback: never expose raw stack or uncaught internal details
    const message = error instanceof Error ? error.message : "An unexpected platform error occurred.";
    return jsonError(message, 500, "INTERNAL_ERROR");
}

export interface PlatformRouteOptions {
    permission?: PlatformPermission;
    permissions?: readonly PlatformPermission[];
    requireAll?: boolean;
}

export type PlatformRouteHandler<TParams = Record<string, string>> = (
    req: NextRequest,
    context: PlatformAuthorizationContext,
    params: TParams
) => Promise<NextResponse>;

/**
 * Higher-order Route Handler wrapper for all `/api/platform/*` endpoints.
 * 
 * Guarantees:
 * 1. Invokes requirePlatformAuthorization() with permission checks.
 * 2. Unwraps route params safely (Next.js 15 Promise<params> compatible).
 * 3. Catches and translates all domain errors through handlePlatformError.
 * 4. Preserves uniform-403 enumeration resistance across all routes.
 */
export function withPlatformAuth<TParams = Record<string, string>>(
    handler: PlatformRouteHandler<TParams>,
    options?: PlatformRouteOptions
) {
    return async (
        req: NextRequest,
        routeContext?: { params?: Promise<TParams> | TParams }
    ): Promise<NextResponse> => {
        try {
            // 1. Authorize platform operator
            let authContext: PlatformAuthorizationContext;
            if (options?.permissions) {
                authContext = await requirePlatformAuthorization(options.permissions, {
                    requireAll: options.requireAll,
                });
            } else if (options?.permission) {
                authContext = await requirePlatformAuthorization(options.permission);
            } else {
                authContext = await requirePlatformAuthorization();
            }

            // 2. Resolve route params (handles both sync and async params)
            const rawParams = routeContext?.params;
            const params = rawParams
                ? rawParams instanceof Promise
                    ? await rawParams
                    : rawParams
                : ({} as TParams);

            // 3. Delegate to handler
            return await handler(req, authContext, params);
        } catch (error) {
            return handlePlatformError(error);
        }
    };
}
