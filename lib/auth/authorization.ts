import type { MembershipRole } from "@/generated/prisma/enums";

import { prisma } from "@/lib/prisma";
import {
    ForbiddenError,
    UnauthorizedError,
    WorkspaceAccessError,
} from "./errors";
import {
    getRolePermissions,
    roleHasAllPermissions,
    roleHasAnyPermission,
    roleHasPermission,
} from "./roles";
import type { Permission } from "./permissions";

/**
 * Represents the authorization context for an authenticated
 * user inside a workspace.
 */
export interface AuthorizationContext {
    userId: string;
    workspaceId: string;
    role: MembershipRole;
}

/**
 * Resolves the active workspace membership for a user.
 */
export async function getAuthorizationContext(
    userId: string,
    workspaceId: string,
): Promise<AuthorizationContext> {
    if (!userId) {
        throw new UnauthorizedError();
    }

    if (!workspaceId) {
        throw new WorkspaceAccessError();
    }

    const membership =
        await prisma.workspaceMember.findFirst({
            where: {
                userId,
                workspaceId,
                status: "ACTIVE",
            },
            select: {
                userId: true,
                workspaceId: true,
                role: true,
            },
        });

    if (!membership) {
        throw new WorkspaceAccessError();
    }

    return {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
    };
}

/**
 * Resolves all permissions available to a user inside
 * a workspace.
 */
export async function getUserPermissions(
    userId: string,
    workspaceId: string,
): Promise<readonly Permission[]> {
    const context =
        await getAuthorizationContext(
            userId,
            workspaceId,
        );

    return getRolePermissions(context.role);
}

/**
 * Checks whether a user has a permission.
 *
 * Returns false instead of throwing when authorization
 * is not available.
 */
export async function hasPermission(
    userId: string,
    workspaceId: string,
    permission: Permission,
): Promise<boolean> {
    if (!userId || !workspaceId) {
        return false;
    }

    const membership =
        await prisma.workspaceMember.findFirst({
            where: {
                userId,
                workspaceId,
                status: "ACTIVE",
            },
            select: {
                role: true,
            },
        });

    if (!membership) {
        return false;
    }

    return roleHasPermission(
        membership.role,
        permission,
    );
}

/**
 * Requires a specific permission.
 */
export async function requirePermission(
    userId: string,
    workspaceId: string,
    permission: Permission,
): Promise<AuthorizationContext> {
    if (!userId) {
        throw new UnauthorizedError();
    }

    if (!workspaceId) {
        throw new WorkspaceAccessError();
    }

    const context =
        await getAuthorizationContext(
            userId,
            workspaceId,
        );

    if (
        !roleHasPermission(
            context.role,
            permission,
        )
    ) {
        throw new ForbiddenError();
    }

    return context;
}

/**
 * Requires at least one permission.
 *
 * An empty permission list always results in denial.
 */
export async function requireAnyPermission(
    userId: string,
    workspaceId: string,
    permissions: readonly Permission[],
): Promise<AuthorizationContext> {
    if (!userId) {
        throw new UnauthorizedError();
    }

    if (!workspaceId) {
        throw new WorkspaceAccessError();
    }

    if (permissions.length === 0) {
        throw new ForbiddenError();
    }

    const context =
        await getAuthorizationContext(
            userId,
            workspaceId,
        );

    if (
        !roleHasAnyPermission(
            context.role,
            permissions,
        )
    ) {
        throw new ForbiddenError();
    }

    return context;
}

/**
 * Requires every supplied permission.
 *
 * An empty permission list always results in denial.
 *
 * This explicit behavior prevents accidental authorization
 * when a caller forgets to provide required permissions.
 */
export async function requireAllPermissions(
    userId: string,
    workspaceId: string,
    permissions: readonly Permission[],
): Promise<AuthorizationContext> {
    if (!userId) {
        throw new UnauthorizedError();
    }

    if (!workspaceId) {
        throw new WorkspaceAccessError();
    }

    if (permissions.length === 0) {
        throw new ForbiddenError();
    }

    const context =
        await getAuthorizationContext(
            userId,
            workspaceId,
        );

    if (
        !roleHasAllPermissions(
            context.role,
            permissions,
        )
    ) {
        throw new ForbiddenError();
    }

    return context;
}