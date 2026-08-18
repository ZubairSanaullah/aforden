import {
    requireWorkspaceRole,
} from "@/lib/auth/roles-authorization";
import {
    requireAuthenticatedUser,
} from "@/lib/auth/api";
import type { MembershipRole } from "@/generated/prisma/enums";
import type { AuthorizationContext } from "@/lib/auth/authorization";

/**
 * Requires authentication and one of the specified workspace roles.
 */
export async function requireApiRole(
    workspaceId: string,
    allowedRoles: readonly MembershipRole[],
): Promise<AuthorizationContext> {
    const userId = await requireAuthenticatedUser();

    return requireWorkspaceRole(
        userId,
        workspaceId,
        allowedRoles,
    );
}

/**
 * Requires authentication and workspace ownership.
 */
export async function requireApiOwner(
    workspaceId: string,
): Promise<AuthorizationContext> {
    const userId = await requireAuthenticatedUser();

    return requireWorkspaceRole(
        userId,
        workspaceId,
        ["OWNER"],
    );
}

/**
 * Requires authentication and workspace administration
 * privileges.
 */
export async function requireApiAdmin(
    workspaceId: string,
): Promise<AuthorizationContext> {
    const userId = await requireAuthenticatedUser();

    return requireWorkspaceRole(
        userId,
        workspaceId,
        ["OWNER", "ADMIN"],
    );
}