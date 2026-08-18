export class UnauthorizedError extends Error {
    constructor(
        message = "Authentication is required."
    ) {
        super(message);

        this.name =
            "UnauthorizedError";
    }
}

export class ForbiddenError extends Error {
    constructor(
        message = "You do not have permission to perform this action."
    ) {
        super(message);

        this.name =
            "ForbiddenError";
    }
}

export class WorkspaceAccessDeniedError
    extends ForbiddenError {
    constructor(
        message = "You do not have access to this workspace."
    ) {
        super(message);

        this.name =
            "WorkspaceAccessDeniedError";
    }
}

export class WorkspaceNotFoundError
    extends Error {
    constructor(
        message = "Workspace not found."
    ) {
        super(message);

        this.name =
            "WorkspaceNotFoundError";
    }
}