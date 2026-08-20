import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { ServiceCatalogOperationalSummary } from "./serviceCatalog.types";

/**
 * Retrieves aggregate operational statistics for the Service Catalog domain within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_VIEW permission.
 *   - Aggregations are strictly scoped to `workspaceId`.
 */
export async function getServiceCatalogOperationalSummary(
    workspaceId: string,
): Promise<ServiceCatalogOperationalSummary> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SERVICE_CATALOG_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_VIEW,
    );

    // --- 3. Parallel Workspace-Scoped Aggregations ---
    const [
        totalCatalogs,
        activeCatalogs,
        inactiveCatalogs,
        totalWorkTypes,
        activeWorkTypes,
    ] = await Promise.all([
        prisma.serviceCatalog.count({
            where: {
                workspaceId,
            },
        }),
        prisma.serviceCatalog.count({
            where: {
                workspaceId,
                status: "ACTIVE",
            },
        }),
        prisma.serviceCatalog.count({
            where: {
                workspaceId,
                status: "INACTIVE",
            },
        }),
        prisma.workType.count({
            where: {
                workspaceId,
            },
        }),
        prisma.workType.count({
            where: {
                workspaceId,
                status: "ACTIVE",
            },
        }),
    ]);

    return {
        workspaceId,
        totalCatalogs,
        activeCatalogs,
        inactiveCatalogs,
        totalWorkTypes,
        activeWorkTypes,
    };
}
