export class PlatformBillingAccountNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "PLATFORM_BILLING_ACCOUNT_NOT_FOUND";

    constructor(identifier: string) {
        super(`Platform billing account for '${identifier}' not found.`);
        this.name = "PlatformBillingAccountNotFoundError";
    }
}

export class PlatformSubscriptionPlanNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "PLATFORM_SUBSCRIPTION_PLAN_NOT_FOUND";

    constructor(identifier: string) {
        super(`Subscription plan '${identifier}' not found.`);
        this.name = "PlatformSubscriptionPlanNotFoundError";
    }
}

export class PlatformSubscriptionNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "PLATFORM_SUBSCRIPTION_NOT_FOUND";

    constructor(identifier: string) {
        super(`Subscription for workspace '${identifier}' not found.`);
        this.name = "PlatformSubscriptionNotFoundError";
    }
}

export class PlatformEntitlementOverrideNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "PLATFORM_ENTITLEMENT_OVERRIDE_NOT_FOUND";

    constructor(workspaceId: string, featureKey: string) {
        super(`Entitlement override '${featureKey}' for workspace '${workspaceId}' not found.`);
        this.name = "PlatformEntitlementOverrideNotFoundError";
    }
}

export class PlatformBillingWebhookNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "PLATFORM_BILLING_WEBHOOK_NOT_FOUND";

    constructor(id: string) {
        super(`Billing webhook event '${id}' not found.`);
        this.name = "PlatformBillingWebhookNotFoundError";
    }
}

export class PlatformBillingValidationError extends Error {
    readonly statusCode = 400;
    readonly code = "PLATFORM_BILLING_VALIDATION_ERROR";

    constructor(message: string) {
        super(message);
        this.name = "PlatformBillingValidationError";
    }
}

export class PlatformBillingConflictError extends Error {
    readonly statusCode = 409;
    readonly code = "PLATFORM_BILLING_CONFLICT";

    constructor(message: string) {
        super(message);
        this.name = "PlatformBillingConflictError";
    }
}
