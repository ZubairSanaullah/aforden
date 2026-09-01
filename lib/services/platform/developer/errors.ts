export class PlatformDeveloperApplicationNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "DEVELOPER_APP_NOT_FOUND";

    constructor(id: string) {
        super(`Developer Application '${id}' not found.`);
        this.name = "PlatformDeveloperApplicationNotFoundError";
    }
}

export class PlatformApiKeyNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "API_KEY_NOT_FOUND";

    constructor(id: string) {
        super(`API Key '${id}' not found.`);
        this.name = "PlatformApiKeyNotFoundError";
    }
}

export class PlatformWebhookEndpointNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "WEBHOOK_ENDPOINT_NOT_FOUND";

    constructor(id: string) {
        super(`Webhook endpoint '${id}' not found.`);
        this.name = "PlatformWebhookEndpointNotFoundError";
    }
}

export class PlatformDeveloperValidationError extends Error {
    readonly statusCode = 400;
    readonly code = "PLATFORM_DEVELOPER_VALIDATION_ERROR";

    constructor(message: string) {
        super(message);
        this.name = "PlatformDeveloperValidationError";
    }
}

export class PlatformDeveloperConflictError extends Error {
    readonly statusCode = 409;
    readonly code = "PLATFORM_DEVELOPER_CONFLICT";

    constructor(message: string) {
        super(message);
        this.name = "PlatformDeveloperConflictError";
    }
}
