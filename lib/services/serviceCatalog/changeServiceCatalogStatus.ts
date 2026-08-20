import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { changeServiceCatalogStatusSchema } from "@/lib/validations/serviceCatalog";
import {
    ServiceCatalogNotFoundError,
    ServiceCatalogUpdateError,
} from "./serviceCatalogErrors";
import type { ServiceCatalogOperationalReadModel } from "./serviceCatalog.types";

/**
 * Transitions the operational lifecycle status of a ServiceCatalog.
 *
 * Security & Lifecycle Invariants:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_UPDATE permission (OWNER, ADMIN, or MANAGER).
 *   - Target lookup is strictly tenant-scoped (`where: { id: catalogId, workspaceId }`).
 *   - Changing ServiceCatalog.status MUST NOT mutate child WorkType.status values.
 *   - Deactivating a catalog functions as an effective availability filter, preserving child states.
 *   - Returns operational read model.
 */
export async function changeServiceCatalogStatus(
    workspaceId: string,
    catalogId: string,
    input: unknown,
): Promise<ServiceCatalogOperationalReadModel> {
    // --- 1. Validate Input ---
    const data = changeServiceCatalogStatusSchema.parse(input);

    // --- 2. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 3. RBAC: Enforce SERVICE_CATALOG_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_UPDATE,
    );

    // --- 4. Verify Catalog Existence in Workspace ---
    const existing = await prisma.serviceCatalog.findFirst({
        where: {
            id: catalogId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new ServiceCatalogNotFoundError();
    }

    // --- 5. Persist Status Mutation ---
    try {
        const updated = await prisma.serviceCatalog.update({
            where: {
                id: catalogId,
            },
            data: {
                status: data.status,
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

        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            name: updated.name,
            description: updated.description,
            status: updated.status,
            sortOrder: updated.sortOrder,
            workTypesCount: updated._count.workTypes,
            activeWorkTypesCount: updated.workTypes.length,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        };
    } catch (error: any) {
        throw new ServiceCatalogUpdateError(
            error instanceof Error
                ? error.message
                : "Failed to update service catalog status.",
        );
    }
}

export const updateServiceCatalogStatus = changeServiceCatalogStatus;
