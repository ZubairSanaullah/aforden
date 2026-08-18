import type { MembershipRole } from "@/generated/prisma/enums";

import {
    getAuthorizationContext,
    type AuthorizationContext,
} from "@/lib/auth/authorization";
import {
    ForbiddenError,
    UnauthorizedError,
} from "@/lib/auth/errors";

/**
 * Requires the authenticated user to have one of the specified
 * roles inside the workspace.
 */
export async function requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    allowedRoles: readonly MembershipRole[],
): Promise<AuthorizationContext> {
    if (!userId) {
        throw new UnauthorizedError();
    }

    const context = await getAuthorizationContext(
        userId,
        workspaceId,
    );

    if (!allowedRoles.includes(context.role)) {
        throw new ForbiddenError();
    }

    return context;
}

/**
 * Checks whether the authenticated user has one of the
 * specified roles inside the workspace.
 *
 * Returns false instead of throwing.
 */
export async function hasWorkspaceRole(
    userId: string,
    workspaceId: string,
    allowedRoles: readonly MembershipRole[],
): Promise<boolean> {
    if (!userId) {
        return false;
    }

    try {
        const context = await getAuthorizationContext(
            userId,
            workspaceId,
        );

        return allowedRoles.includes(context.role);
    } catch {
        return false;
    }
}

/**
 * Requires the user to be the workspace owner.
 */
export async function requireWorkspaceOwner(
    userId: string,
    workspaceId: string,
): Promise<AuthorizationContext> {
    return requireWorkspaceRole(
        userId,
        workspaceId,
        ["OWNER"],
    );
}

/**
 * Requires the user to have workspace administration authority.
 *
 * OWNER and ADMIN are considered workspace administrators.
 */
export async function requireWorkspaceAdmin(
    userId: string,
    workspaceId: string,
): Promise<AuthorizationContext> {
    return requireWorkspaceRole(
        userId,
        workspaceId,
        ["OWNER", "ADMIN"],
    );
}