import {
    requireWorkspaceAuthorization,
} from "./workspaceAuthorization";

import {
    assertPermission,
    assertAnyPermission,
    assertAllPermissions,
} from "./permissionService";

import type {
    Permission,
} from "./permissions";

import type {
    WorkspaceAuthorizationContext,
} from "./types";

export async function requirePermission(
    workspaceId: string,
    permission: Permission
): Promise<WorkspaceAuthorizationContext> {
    const authorization =
        await requireWorkspaceAuthorization(
            workspaceId
        );

    assertPermission(
        authorization.membership.role,
        permission
    );

    return authorization;
}

export async function requireAnyPermission(
    workspaceId: string,
    permissions: readonly Permission[]
): Promise<WorkspaceAuthorizationContext> {
    const authorization =
        await requireWorkspaceAuthorization(
            workspaceId
        );

    assertAnyPermission(
        authorization.membership.role,
        permissions
    );

    return authorization;
}

export async function requireAllPermissions(
    workspaceId: string,
    permissions: readonly Permission[]
): Promise<WorkspaceAuthorizationContext> {
    const authorization =
        await requireWorkspaceAuthorization(
            workspaceId
        );

    assertAllPermissions(
        authorization.membership.role,
        permissions
    );

    return authorization;
}