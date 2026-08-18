import {
    getAuthorizationContext,
    type AuthorizationContext,
} from "@/lib/auth/authorization";
import { UnauthorizedError } from "@/lib/auth/errors";

/**
 * Resolves and verifies the authenticated user's access
 * to a workspace.
 */
export async function requireTenantAccess(
    userId: string,
    workspaceId: string,
): Promise<AuthorizationContext> {
    if (!userId) {
        throw new UnauthorizedError();
    }

    return getAuthorizationContext(
        userId,
        workspaceId,
    );
}

/**
 * Creates a workspace scope that can be merged into Prisma
 * where clauses for workspace-owned resources.
 *
 * Example:
 *
 * prisma.customer.findFirst({
 *   where: {
 *     id: customerId,
 *     ...workspaceScope(workspaceId),
 *   },
 * });
 */
export function workspaceScope(
    workspaceId: string,
): { workspaceId: string } {
    return {
        workspaceId,
    };
}