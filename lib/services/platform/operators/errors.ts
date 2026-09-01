export class PlatformOperatorNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "OPERATOR_NOT_FOUND";

    constructor(identifier: string) {
        super(`Platform operator '${identifier}' not found.`);
        this.name = "PlatformOperatorNotFoundError";
    }
}

export class PlatformOperatorConflictError extends Error {
    readonly statusCode = 409;
    readonly code = "OPERATOR_CONFLICT";

    constructor(message: string) {
        super(message);
        this.name = "PlatformOperatorConflictError";
    }
}

export class PlatformLastOwnerProtectionError extends Error {
    readonly statusCode = 409;
    readonly code = "LAST_OWNER_PROTECTION";

    constructor(
        message = "Cannot demote or deactivate the last remaining active PLATFORM_OWNER. The platform must maintain at least one active owner."
    ) {
        super(message);
        this.name = "PlatformLastOwnerProtectionError";
    }
}

export class PlatformSelfModificationError extends Error {
    readonly statusCode = 403;
    readonly code = "SELF_MODIFICATION_PROHIBITED";

    constructor(
        message = "Operators cannot alter their own platform role or deactivation status. Another platform owner must perform this action."
    ) {
        super(message);
        this.name = "PlatformSelfModificationError";
    }
}

export class PlatformOperatorValidationError extends Error {
    readonly statusCode = 400;
    readonly code = "INVALID_OPERATOR_INPUT";

    constructor(message: string) {
        super(message);
        this.name = "PlatformOperatorValidationError";
    }
}
