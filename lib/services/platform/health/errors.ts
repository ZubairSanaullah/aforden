/**
 * Platform Health Domain Errors
 */
export class PlatformHealthError extends Error {
    public readonly code: string;

    constructor(message: string, code: string = "PLATFORM_HEALTH_ERROR") {
        super(message);
        this.name = "PlatformHealthError";
        this.code = code;
        Object.setPrototypeOf(this, PlatformHealthError.prototype);
    }
}

export class PlatformHealthCheckError extends PlatformHealthError {
    constructor(subsystem: string, cause?: unknown) {
        super(
            `Platform health check failed for subsystem '${subsystem}': ${
                cause instanceof Error ? cause.message : String(cause)
            }`,
            "PLATFORM_HEALTH_CHECK_FAILED"
        );
        this.name = "PlatformHealthCheckError";
        Object.setPrototypeOf(this, PlatformHealthCheckError.prototype);
    }
}
