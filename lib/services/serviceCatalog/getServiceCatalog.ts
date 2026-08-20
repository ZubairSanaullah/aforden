import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { ServiceCatalogNotFoundError } from "./serviceCatalogErrors";
import type { ServiceCatalogOperationalReadModel } from "./serviceCatalog.types";

/**
 * Retrieves an individual ServiceCatalog by ID within an authorized workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_VIEW permission.
 *   - Query is strictly tenant-scoped (`where: { id: catalogId, workspaceId }`).
 *   - Returns operational read model with aggregated work type metrics.
 *   - Never leaks existence of catalogs belonging to other workspaces.
 */
export async function getServiceCatalog(
    workspaceId: string,
    catalogId: string,
): Promise<ServiceCatalogOperationalReadModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SERVICE_CATALOG_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_VIEW,
    );

    // --- 3. Scoped Operational Query ---
    const catalog = await prisma.serviceCatalog.findFirst({
        where: {
            id: catalogId,
            workspaceId,
        },
        include: {
            _count: {
                select: {
                    workTypes: true,
                },
            },
            workTypes: {
                where: {
                    status: "ACTIVE",
                },
                select: {
                    id: true,
                },
            },
        },
    });

    if (!catalog) {
        throw new ServiceCatalogNotFoundError();
    }

    return {
        id: catalog.id,
        workspaceId: catalog.workspaceId,
        name: catalog.name,
        description: catalog.description,
        status: catalog.status,
        sortOrder: catalog.sortOrder,
        workTypesCount: catalog._count.workTypes,
        activeWorkTypesCount: catalog.workTypes.length,
        createdAt: catalog.createdAt,
        updatedAt: catalog.updatedAt,
    };
}
