import type {
    MembershipRole,
} from "@/generated/prisma/client";

import {
    requireWorkspaceAuthorization,
} from "./workspaceAuthorization";

import {
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
} from "./requirePermission";

import {
    assertMinimumRole,
    assertOwner,
    assertAdminOrOwner,
} from "./roleService";

import type {
    Permission,
} from "./permissions";

import type {
    WorkspaceAuthorizationContext,
} from "./types";

export async function authorizeWorkspace(
    workspaceId: string
): Promise<WorkspaceAuthorizationContext> {
    return requireWorkspaceAuthorization(
        workspaceId
    );
}

export async function authorizePermission(
    workspaceId: string,
    permission: Permission
): Promise<WorkspaceAuthorizationContext> {
    return requirePermission(
        workspaceId,
        permission
    );
}

export async function authorizeAnyPermission(
    workspaceId: string,
    permissions: readonly Permission[]
): Promise<WorkspaceAuthorizationContext> {
    return requireAnyPermission(
        workspaceId,
        permissions
    );
}

export async function authorizeAllPermissions(
    workspaceId: string,
    permissions: readonly Permission[]
): Promise<WorkspaceAuthorizationContext> {
    return requireAllPermissions(
        workspaceId,
        permissions
    );
}

export async function authorizeRole(
    workspaceId: string,
    minimumRole: MembershipRole
): Promise<WorkspaceAuthorizationContext> {
    const authorization =
        await requireWorkspaceAuthorization(
            workspaceId
        );

    assertMinimumRole(
        authorization.membership.role,
        minimumRole
    );

    return authorization;
}

export async function authorizeOwner(
    workspaceId: string
): Promise<WorkspaceAuthorizationContext> {
    const authorization =
        await requireWorkspaceAuthorization(
            workspaceId
        );

    assertOwner(
        authorization.membership.role
    );

    return authorization;
}

export async function authorizeAdminOrOwner(
    workspaceId: string
): Promise<WorkspaceAuthorizationContext> {
    const authorization =
        await requireWorkspaceAuthorization(
            workspaceId
        );

    assertAdminOrOwner(
        authorization.membership.role
    );

    return authorization;
}