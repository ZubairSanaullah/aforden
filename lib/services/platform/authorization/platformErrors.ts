export class PlatformAuthorizationError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(message: string, statusCode = 403, code = "PLATFORM_ACCESS_DENIED") {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
    }
}

export class PlatformUnauthorizedError extends PlatformAuthorizationError {
    constructor(message = "Platform operator authentication required") {
        super(message, 401, "PLATFORM_UNAUTHORIZED");
    }
}

export class PlatformAccessDeniedError extends PlatformAuthorizationError {
    constructor(message = "Access denied: user is not a platform operator") {
        super(message, 403, "PLATFORM_ACCESS_DENIED");
    }
}

export class PlatformAdminInactiveError extends PlatformAuthorizationError {
    constructor(status: string) {
        super(`Platform operator account is ${status.toLowerCase()}`, 403, "PLATFORM_OPERATOR_INACTIVE");
    }
}

export class PlatformSessionExpiredError extends PlatformAuthorizationError {
    constructor(message = "Platform operator session idle timeout exceeded (30m). Please re-authenticate.") {
        super(message, 401, "PLATFORM_SESSION_EXPIRED");
    }
}
