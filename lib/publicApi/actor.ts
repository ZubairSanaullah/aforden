import { getAuthenticatedApiContext } from "./context";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { MembershipRole } from "@/generated/prisma/client";

/**
 * Constructs a synthetic WorkspaceAuthorizationContext for machine-to-machine
 * Public API requests authenticated via an API Key.
 *
 * Least-Privilege Role Grant:
 * - Defaults to `DISPATCHER` (least-privilege operational role with tenant-wide
 *   `WORK_ORDERS_VIEW`, `WORK_ORDERS_CREATE`, `WORK_ORDERS_UPDATE`, and `SERVICE_CATALOG_VIEW`).
 * - Never grants administrative privileges (`MEMBERS_MANAGE`, `SETTINGS_UPDATE`,
 *   `BILLING_MANAGE`, `AUTOMATIONS_MANAGE`, or `WORK_ORDERS_DELETE`).
 *
 * This allows reusing existing domain services without modification to internal RBAC guards.
 */
export function getPublicApiActorContext(
    role: MembershipRole = "DISPATCHER",
): WorkspaceAuthorizationContext {
    const auth = getAuthenticatedApiContext();

    return {
        user: {
            id: `api_app_${auth.developerApplicationId}`,
            name: auth.developerApplicationName,
            email: `developer-app-${auth.developerApplicationId}@aforden.internal`,
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: {
            id: auth.workspaceId,
            name: "Public API Scoped Workspace",
            slug: auth.workspaceId,
            logoUrl: null,
            timezone: "UTC",
        },
        membership: {
            id: `api_mem_${auth.apiKeyId}`,
            role,
            status: "ACTIVE",
        },
    };
}
