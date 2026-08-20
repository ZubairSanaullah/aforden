import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    ServiceCatalogNotFoundError,
    ServiceCatalogDeletionNotAllowedError,
    ServiceCatalogDeletionError,
} from "./serviceCatalogErrors";
import type { ServiceCatalogOperationalReadModel } from "./serviceCatalog.types";

/**
 * Evaluates whether a ServiceCatalog is eligible for hard deletion.
 *
 * Deletion Invariants:
 *   - ACTIVE catalogs cannot be deleted directly (must first be deactivated).
 *   - INACTIVE catalogs with one or more child WorkTypes cannot be deleted.
 *   - Only INACTIVE catalogs with zero child WorkTypes are eligible for deletion.
 */
export function assertServiceCatalogCanBeDeleted(catalog: {
    status: string;
    _count?: { workTypes: number };
}): void {
    if (catalog.status === "ACTIVE") {
        throw new ServiceCatalogDeletionNotAllowedError(
            "Active service catalogs cannot be deleted. The catalog must first be deactivated.",
        );
    }

    if (catalog._count && catalog._count.workTypes > 0) {
        throw new ServiceCatalogDeletionNotAllowedError(
            "Cannot delete service catalog with existing work types. All child work types must be deleted or reassigned first.",
        );
    }
}

/**
 * Hard deletes a ServiceCatalog from a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_DELETE permission (OWNER or ADMIN).
 *   - Target lookup is strictly tenant-scoped (`where: { id: catalogId, workspaceId }`).
 *   - Catalog must be INACTIVE and contain zero child work types.
 *   - Never leaks existence of catalogs in other workspaces.
 *   - Returns deleted operational read model.
 */
export async function deleteServiceCatalog(
    workspaceId: string,
    catalogId: string,
): Promise<ServiceCatalogOperationalReadModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SERVICE_CATALOG_DELETE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_DELETE,
    );

    // --- 3. Scoped Catalog Lookup with Child Count ---
    const existing = await prisma.serviceCatalog.findFirst({
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
        },
    });

    if (!existing) {
        throw new ServiceCatalogNotFoundError();
    }

    // --- 4. Assert Domain Deletion Invariants ---
    assertServiceCatalogCanBeDeleted(existing);

    // --- 5. Execute Hard Deletion with Error Translation ---
    try {
        await prisma.serviceCatalog.delete({
            where: {
                id: catalogId,
            },
        });

        return {
            id: existing.id,
            workspaceId: existing.workspaceId,
            name: existing.name,
            description: existing.description,
            status: existing.status,
            sortOrder: existing.sortOrder,
            workTypesCount: 0,
            activeWorkTypesCount: 0,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
        };
    } catch (error: any) {
        if (error?.code === "P2025") {
            throw new ServiceCatalogNotFoundError();
        }

        if (error?.code === "P2003") {
            throw new ServiceCatalogDeletionNotAllowedError(
                "Cannot delete service catalog because protected references exist.",
            );
        }

        throw new ServiceCatalogDeletionError(
            error instanceof Error
                ? error.message
                : "Failed to delete service catalog record.",
        );
    }
}
