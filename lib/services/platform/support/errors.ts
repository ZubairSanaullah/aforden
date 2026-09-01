export class PlatformWorkspaceSupportNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = "WORKSPACE_NOT_FOUND";

    constructor(workspaceId: string) {
        super(`Workspace '${workspaceId}' was not found for support diagnostic access.`);
        this.name = "PlatformWorkspaceSupportNotFoundError";
    }
}
