import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization/authorizationResponse";
import {
    NotificationNotFoundError,
    NotificationDeliveryNotFoundError,
    NotificationTemplateNotFoundError,
    NotificationPreferenceNotFoundError,
    InvalidNotificationEventType,
    InvalidNotificationChannelError,
    DuplicateNotificationEventError,
    NotificationCrossTenantLeakageError,
    NotificationActorUnauthorizedError,
    NotificationPayloadValidationError,
    NotificationTemplateCompilationError,
    NotificationRecipientUnresolvableError,
    NotificationChannelDisabledError,
    NotificationDeliveryExhaustedError,
    NotificationProviderUnavailableError,
} from "@/lib/services/notification/notificationErrors";

/**
 * Maps error types from the Notifications & Communications domain into standardized HTTP responses.
 */
export function handleNotificationApiError(
    error: unknown,
    context?: string,
): NextResponse {
    // 1. Check authorization errors (401 Unauthorized, 403 Forbidden)
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) {
        return authResponse;
    }

    // 2. Check Zod validation errors (422 Unprocessable Entity)
    if (error instanceof ZodError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "VALIDATION_ERROR",
                    message: "Validation failed for notification request.",
                    details: error.issues.map((i) => ({
                        field: i.path.join("."),
                        message: i.message,
                    })),
                },
            },
            { status: 422 },
        );
    }

    // 3. Domain Not Found Errors (404)
    if (
        error instanceof NotificationNotFoundError ||
        error instanceof NotificationDeliveryNotFoundError ||
        error instanceof NotificationTemplateNotFoundError ||
        error instanceof NotificationPreferenceNotFoundError ||
        error instanceof NotificationRecipientUnresolvableError
    ) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            { status: 404 },
        );
    }

    // 4. Domain Unauthorized / Forbidden Errors (403)
    if (
        error instanceof NotificationActorUnauthorizedError ||
        error instanceof NotificationCrossTenantLeakageError
    ) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            { status: 403 },
        );
    }

    // 5. Conflict Errors (409)
    if (error instanceof DuplicateNotificationEventError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            { status: 409 },
        );
    }

    // 6. Domain Payload / Compilation / Channel Disabled Errors (422)
    if (
        error instanceof NotificationPayloadValidationError ||
        error instanceof NotificationTemplateCompilationError ||
        error instanceof NotificationChannelDisabledError
    ) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            { status: 422 },
        );
    }

    // 7. Bad Request Errors (400)
    if (
        error instanceof InvalidNotificationEventType ||
        error instanceof InvalidNotificationChannelError
    ) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            { status: 400 },
        );
    }

    // 8. Provider Unavailable / Service Unavailable (503)
    if (error instanceof NotificationProviderUnavailableError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            { status: 503 },
        );
    }

    // 9. Delivery Exhausted / Internal Error (500)
    if (error instanceof NotificationDeliveryExhaustedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            { status: 500 },
        );
    }

    // 10. Generic Fallback (500) - Sanitized
    console.error(`[Notification API Error] [${context || "Unknown"}]:`, error);
    return NextResponse.json(
        {
            success: false,
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "An unexpected error occurred while processing notification request.",
            },
        },
        { status: 500 },
    );
}

/**
 * Extracts URL search params as a Record<string, any>.
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
