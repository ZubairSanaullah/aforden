import {
    WorkspaceAccessDeniedError,
} from "./authorizationErrors";

import type {
    WorkspaceAuthorizationContext,
} from "./types";

export function assertWorkspaceResource(
    authorization: WorkspaceAuthorizationContext,
    resourceWorkspaceId: string
): void {
    if (
        authorization.workspace.id !==
        resourceWorkspaceId
    ) {
        throw new WorkspaceAccessDeniedError();
    }
}

export function getAuthorizedWorkspaceId(
    authorization: WorkspaceAuthorizationContext
): string {
    return authorization.workspace.id;
}