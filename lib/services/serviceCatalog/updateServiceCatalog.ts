import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateServiceCatalogSchema } from "@/lib/validations/serviceCatalog";
import {
    ServiceCatalogNotFoundError,
    DuplicateServiceCatalogNameError,
    ServiceCatalogUpdateError,
} from "./serviceCatalogErrors";
import type { ServiceCatalogOperationalReadModel } from "./serviceCatalog.types";

/**
 * Updates editable fields of a ServiceCatalog within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_UPDATE permission (OWNER, ADMIN, or MANAGER).
 *   - Inputs are validated via Zod (`updateServiceCatalogSchema`).
 *   - Cannot modify `id`, `workspaceId`, `status`, or audit timestamps.
 *   - Target lookup is strictly tenant-scoped (`where: { id: catalogId, workspaceId }`).
 *   - Handles Prisma unique constraint violations on `[workspaceId, name]` gracefully.
 *   - Returns operational read model.
 */
export async function updateServiceCatalog(
    workspaceId: string,
    catalogId: string,
    input: unknown,
): Promise<ServiceCatalogOperationalReadModel> {
    // --- 1. Validate Input ---
    const data = updateServiceCatalogSchema.parse(input);

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

    // --- 5. Persist Updates with Concurrency Protection ---
    try {
        const updated = await prisma.serviceCatalog.update({
            where: {
                id: catalogId,
            },
            data: {
                ...(data.name !== undefined && { name: data.name }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
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
        const isUniqueConstraintViolation =
            error?.code === "P2002" ||
            (typeof error?.message === "string" &&
                error.message.includes("Unique constraint failed"));

        if (isUniqueConstraintViolation) {
            throw new DuplicateServiceCatalogNameError();
        }

        throw new ServiceCatalogUpdateError(
            error instanceof Error
                ? error.message
                : "Failed to update service catalog record.",
        );
    }
}
