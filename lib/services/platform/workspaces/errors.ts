export class PlatformActionValidationError extends Error {
    readonly statusCode = 400;
    readonly code = "INVALID_JUSTIFICATION_REASON";

    constructor(
        message = "A valid justification reason of at least 10 characters is mandatory."
    ) {
        super(message);
        this.name = "PlatformActionValidationError";
    }
}

export class PlatformWorkspaceNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "WORKSPACE_NOT_FOUND";

    constructor(workspaceId: string) {
        super(`Workspace '${workspaceId}' not found.`);
        this.name = "PlatformWorkspaceNotFoundError";
    }
}

export class PlatformWorkspaceConflictError extends Error {
    readonly statusCode = 409;
    readonly code = "WORKSPACE_CONFLICT";

    constructor(message: string) {
        super(message);
        this.name = "PlatformWorkspaceConflictError";
    }
}
