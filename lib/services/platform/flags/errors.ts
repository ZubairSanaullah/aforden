export class PlatformFeatureFlagNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "FEATURE_FLAG_NOT_FOUND";

    constructor(flagKey: string) {
        super(`Feature flag '${flagKey}' was not found.`);
        this.name = "PlatformFeatureFlagNotFoundError";
    }
}

export class PlatformFeatureFlagConflictError extends Error {
    readonly statusCode = 409;
    readonly code = "FEATURE_FLAG_CONFLICT";

    constructor(flagKey: string) {
        super(`Feature flag key '${flagKey}' already exists.`);
        this.name = "PlatformFeatureFlagConflictError";
    }
}

export class PlatformFeatureFlagValidationError extends Error {
    readonly statusCode = 400;
    readonly code = "INVALID_FEATURE_FLAG_INPUT";

    constructor(message: string) {
        super(message);
        this.name = "PlatformFeatureFlagValidationError";
    }
}
