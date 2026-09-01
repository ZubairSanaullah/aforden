export class PlatformRuntimeSettingNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "RUNTIME_SETTING_NOT_FOUND";

    constructor(settingKey: string) {
        super(`Runtime setting '${settingKey}' was not found.`);
        this.name = "PlatformRuntimeSettingNotFoundError";
    }
}

export class PlatformRuntimeSettingConflictError extends Error {
    readonly statusCode = 409;
    readonly code = "RUNTIME_SETTING_CONFLICT";

    constructor(settingKey: string) {
        super(`Runtime setting key '${settingKey}' already exists.`);
        this.name = "PlatformRuntimeSettingConflictError";
    }
}

export class PlatformRuntimeSettingValidationError extends Error {
    readonly statusCode = 400;
    readonly code = "INVALID_RUNTIME_SETTING_INPUT";

    constructor(message: string) {
        super(message);
        this.name = "PlatformRuntimeSettingValidationError";
    }
}

export class PlatformRuntimeSettingProtectedError extends Error {
    readonly statusCode = 403;
    readonly code = "PROTECTED_RUNTIME_SETTING_REQUIRED_STEP_UP";

    constructor(settingKey: string) {
        super(
            `Runtime setting '${settingKey}' is protected and requires Tier-2 step-up authentication and a valid justification reason (min 10 characters).`
        );
        this.name = "PlatformRuntimeSettingProtectedError";
    }
}
