import { prisma } from "@/lib/prisma";

import { auth } from "@/auth";
import {
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
    type AuthorizationContext,
} from "@/lib/auth/authorization";
import {
    ForbiddenError,
    UnauthorizedError,
    WorkspaceAccessError,
} from "@/lib/auth/errors";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Returns the currently authenticated user's ID.
 *
 * Throws UnauthorizedError when no valid session exists.
 */
export async function requireAuthenticatedUser(): Promise<string> {
    const session = await auth();

    const userId = session?.user?.id;

    if (!userId) {
        throw new UnauthorizedError();
    }

    const user = await prisma.user.findUnique({
        where: {
            id: userId,
        },
        select: {
            id: true,
            status: true,
            emailVerified: true,
        },
    });

    if (!user) {
        throw new UnauthorizedError();
    }

    if (
        user.status !== "ACTIVE" ||
        !user.emailVerified
    ) {
        throw new ForbiddenError();
    }

    return user.id;
}

/**
 * Requires authentication and a specific workspace permission.
 *
 * The user ID is always resolved from the server-side session.
 * It is never accepted from request input.
 */
export async function requireApiPermission(
    workspaceId: string,
    permission: Permission,
): Promise<AuthorizationContext> {
    const userId = await requireAuthenticatedUser();

    return requirePermission(
        userId,
        workspaceId,
        permission,
    );
}

/**
 * Requires authentication and at least one permission.
 */
export async function requireApiAnyPermission(
    workspaceId: string,
    permissions: readonly Permission[],
): Promise<AuthorizationContext> {
    const userId = await requireAuthenticatedUser();

    return requireAnyPermission(
        userId,
        workspaceId,
        permissions,
    );
}

/**
 * Requires authentication and every supplied permission.
 */
export async function requireApiAllPermissions(
    workspaceId: string,
    permissions: readonly Permission[],
): Promise<AuthorizationContext> {
    const userId = await requireAuthenticatedUser();

    return requireAllPermissions(
        userId,
        workspaceId,
        permissions,
    );
}

/**
 * Converts authorization errors into safe API responses.
 *
 * No internal authorization details are exposed to clients.
 */
export function authorizationErrorResponse(
    error: unknown,
): Response | null {
    if (error instanceof UnauthorizedError) {
        return Response.json(
            {
                error: "UNAUTHORIZED",
                message: "Authentication is required.",
            },
            {
                status: 401,
            },
        );
    }

    if (error instanceof WorkspaceAccessError) {
        return Response.json(
            {
                error: "FORBIDDEN",
                message: "You do not have access to this workspace.",
            },
            {
                status: 403,
            },
        );
    }

    if (error instanceof ForbiddenError) {
        return Response.json(
            {
                error: "FORBIDDEN",
                message:
                    "You do not have permission to perform this action.",
            },
            {
                status: 403,
            },
        );
    }

    return null;
}