/**
 * Authorization-related application errors.
 *
 * These errors are intentionally separated from HTTP response
 * handling so services can remain reusable.
 */

export class UnauthorizedError extends Error {
    readonly code: string = "UNAUTHORIZED";

    constructor(message = "Authentication is required.") {
        super(message);

        this.name = "UnauthorizedError";
    }
}

export class ForbiddenError extends Error {
    readonly code: string = "FORBIDDEN";

    constructor(message = "You do not have permission to perform this action.") {
        super(message);

        this.name = "ForbiddenError";
    }
}

export class WorkspaceAccessError extends ForbiddenError {
    override readonly code: string = "WORKSPACE_ACCESS_DENIED";

    constructor(message = "You do not have access to this workspace.") {
        super(message);

        this.name = "WorkspaceAccessError";
    }
}