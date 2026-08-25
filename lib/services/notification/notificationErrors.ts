/**
 * Phase 1.13.3 — Notifications & Communications Pure Domain Error Classes
 * Follows Convention B: pure Error subclasses with immutable readonly code, statusCode, and httpStatus metadata.
 */

export class NotificationNotFoundError extends Error {
    readonly code = "NOTIFICATION_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Notification not found.") {
        super(message);
        this.name = "NotificationNotFoundError";
    }
}

export class NotificationDeliveryNotFoundError extends Error {
    readonly code = "NOTIFICATION_DELIVERY_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Notification delivery record not found.") {
        super(message);
        this.name = "NotificationDeliveryNotFoundError";
    }
}

export class NotificationTemplateNotFoundError extends Error {
    readonly code = "NOTIFICATION_TEMPLATE_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Notification template not found.") {
        super(message);
        this.name = "NotificationTemplateNotFoundError";
    }
}

export class NotificationPreferenceNotFoundError extends Error {
    readonly code = "NOTIFICATION_PREFERENCE_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Notification preference record not found.") {
        super(message);
        this.name = "NotificationPreferenceNotFoundError";
    }
}

export class InvalidNotificationEventType extends Error {
    readonly code = "INVALID_NOTIFICATION_EVENT_TYPE";
    readonly statusCode = 400;
    readonly httpStatus = 400;

    constructor(message = "Invalid or unsupported notification event type.") {
        super(message);
        this.name = "InvalidNotificationEventType";
    }
}

export class InvalidNotificationChannelError extends Error {
    readonly code = "INVALID_NOTIFICATION_CHANNEL";
    readonly statusCode = 400;
    readonly httpStatus = 400;

    constructor(message = "Invalid or unsupported notification channel.") {
        super(message);
        this.name = "InvalidNotificationChannelError";
    }
}

export class DuplicateNotificationEventError extends Error {
    readonly code = "DUPLICATE_NOTIFICATION_EVENT";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Duplicate notification event detected by idempotency key.",
    ) {
        super(message);
        this.name = "DuplicateNotificationEventError";
    }
}

export class NotificationCrossTenantLeakageError extends Error {
    readonly code = "NOTIFICATION_CROSS_TENANT_LEAKAGE";
    readonly statusCode = 403;
    readonly httpStatus = 403;

    constructor(
        message = "Recipient or entity does not belong to the event workspace.",
    ) {
        super(message);
        this.name = "NotificationCrossTenantLeakageError";
    }
}

export class NotificationActorUnauthorizedError extends Error {
    readonly code = "NOTIFICATION_ACTOR_UNAUTHORIZED";
    readonly statusCode = 403;
    readonly httpStatus = 403;

    constructor(
        message = "Actor does not have permission to view or manage this notification resource.",
    ) {
        super(message);
        this.name = "NotificationActorUnauthorizedError";
    }
}

export class NotificationPayloadValidationError extends Error {
    readonly code = "NOTIFICATION_PAYLOAD_VALIDATION_ERROR";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Event payload failed schema validation for this event type.",
    ) {
        super(message);
        this.name = "NotificationPayloadValidationError";
    }
}

export class NotificationTemplateCompilationError extends Error {
    readonly code = "NOTIFICATION_TEMPLATE_COMPILATION_ERROR";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Template compilation failed due to invalid token syntax or missing variable.",
    ) {
        super(message);
        this.name = "NotificationTemplateCompilationError";
    }
}

export class NotificationRecipientUnresolvableError extends Error {
    readonly code = "NOTIFICATION_RECIPIENT_UNRESOLVABLE";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Recipient cannot be resolved to a valid communication destination.",
    ) {
        super(message);
        this.name = "NotificationRecipientUnresolvableError";
    }
}

export class NotificationChannelDisabledError extends Error {
    readonly code = "NOTIFICATION_CHANNEL_DISABLED";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "The requested communication channel is disabled for this workspace.",
    ) {
        super(message);
        this.name = "NotificationChannelDisabledError";
    }
}

export class NotificationDeliveryExhaustedError extends Error {
    readonly code = "NOTIFICATION_DELIVERY_EXHAUSTED";
    readonly statusCode = 500;
    readonly httpStatus = 500;

    constructor(
        message = "Notification delivery exceeded maximum retry attempts.",
    ) {
        super(message);
        this.name = "NotificationDeliveryExhaustedError";
    }
}

export class NotificationProviderUnavailableError extends Error {
    readonly code = "NOTIFICATION_PROVIDER_UNAVAILABLE";
    readonly statusCode = 503;
    readonly httpStatus = 503;

    constructor(
        message = "Third-party notification transport provider is currently unreachable.",
    ) {
        super(message);
        this.name = "NotificationProviderUnavailableError";
    }
}
