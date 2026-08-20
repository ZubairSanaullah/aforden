import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { WorkTypeNotFoundError } from "./workTypeErrors";
import type { WorkTypeOperationalReadModel } from "./workType.types";

/**
 * Retrieves a single WorkType by ID within an authorized workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_VIEW permission.
 *   - Query is strictly tenant-scoped (`where: { id: workTypeId, workspaceId }`).
 *   - Computes effective availability (`isAvailableForWorkOrder`).
 *   - Never leaks cross-tenant existence.
 */
export async function getWorkType(
    workspaceId: string,
    workTypeId: string,
): Promise<WorkTypeOperationalReadModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SERVICE_CATALOG_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_VIEW,
    );

    // --- 3. Scoped WorkType Query with Parent Catalog ---
    const workType = await prisma.workType.findFirst({
        where: {
            id: workTypeId,
            workspaceId,
        },
        include: {
            catalog: true,
        },
    });

    if (!workType) {
        throw new WorkTypeNotFoundError();
    }

    return {
        id: workType.id,
        workspaceId: workType.workspaceId,
        catalogId: workType.catalogId,
        catalogName: workType.catalog.name,
        catalogStatus: workType.catalog.status,
        name: workType.name,
        code: workType.code,
        description: workType.description,
        estimatedDuration: workType.estimatedDuration,
        status: workType.status,
        sortOrder: workType.sortOrder,
        isAvailableForWorkOrder:
            workType.status === "ACTIVE" &&
            workType.catalog.status === "ACTIVE",
        createdAt: workType.createdAt,
        updatedAt: workType.updatedAt,
    };
}
