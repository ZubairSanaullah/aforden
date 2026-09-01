export class PlatformIntegrationNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "PLATFORM_INTEGRATION_NOT_FOUND";

    constructor(id: string) {
        super(`Integration provider '${id}' not found in catalog.`);
        this.name = "PlatformIntegrationNotFoundError";
    }
}

export class PlatformIntegrationConnectionNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "PLATFORM_INTEGRATION_CONNECTION_NOT_FOUND";

    constructor(id: string) {
        super(`Integration connection '${id}' not found.`);
        this.name = "PlatformIntegrationConnectionNotFoundError";
    }
}

export class PlatformIntegrationCredentialNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "PLATFORM_INTEGRATION_CREDENTIAL_NOT_FOUND";

    constructor(id: string) {
        super(`Integration credential '${id}' not found.`);
        this.name = "PlatformIntegrationCredentialNotFoundError";
    }
}

export class PlatformIntegrationValidationError extends Error {
    readonly statusCode = 400;
    readonly code = "PLATFORM_INTEGRATION_VALIDATION_ERROR";

    constructor(message: string) {
        super(message);
        this.name = "PlatformIntegrationValidationError";
    }
}

export class PlatformIntegrationConflictError extends Error {
    readonly statusCode = 409;
    readonly code = "PLATFORM_INTEGRATION_CONFLICT";

    constructor(message: string) {
        super(message);
        this.name = "PlatformIntegrationConflictError";
    }
}
