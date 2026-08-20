import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    WorkTypeNotFoundError,
    WorkTypeDeletionNotAllowedError,
    WorkTypeDeletionError,
} from "./workTypeErrors";
import type { WorkTypeOperationalReadModel } from "./workType.types";

/**
 * Hard deletes a WorkType from an authorized workspace.
 *
 * Security & Deletion Invariants:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_DELETE permission (OWNER or ADMIN).
 *   - Target lookup is strictly tenant-scoped (`where: { id: workTypeId, workspaceId }`).
 *   - ACTIVE work types cannot be deleted (must first be deactivated).
 *   - Translates foreign key restrict violations (P2003) to `WorkTypeDeletionNotAllowedError`.
 *   - Returns deleted operational read model.
 */
export async function deleteWorkType(
    workspaceId: string,
    workTypeId: string,
): Promise<WorkTypeOperationalReadModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SERVICE_CATALOG_DELETE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_DELETE,
    );

    // --- 3. Locate Existing WorkType in Workspace ---
    const existing = await prisma.workType.findFirst({
        where: {
            id: workTypeId,
            workspaceId,
        },
        include: {
            catalog: true,
            _count: {
                select: {
                    workOrders: true,
                },
            },
        },
    });

    if (!existing) {
        throw new WorkTypeNotFoundError();
    }

    // --- 4. Assert Domain Deletion Invariants ---
    if (existing.status === "ACTIVE") {
        throw new WorkTypeDeletionNotAllowedError(
            "Active work types cannot be deleted. The work type must first be deactivated.",
        );
    }

    if (existing._count && existing._count.workOrders > 0) {
        throw new WorkTypeDeletionNotAllowedError(
            "Cannot delete work type because it is referenced by existing work orders.",
        );
    }

    // --- 5. Execute Hard Deletion with Error Translation ---
    try {
        await prisma.workType.delete({
            where: {
                id: workTypeId,
            },
        });

        return {
            id: existing.id,
            workspaceId: existing.workspaceId,
            catalogId: existing.catalogId,
            catalogName: existing.catalog.name,
            catalogStatus: existing.catalog.status,
            name: existing.name,
            code: existing.code,
            description: existing.description,
            estimatedDuration: existing.estimatedDuration,
            status: existing.status,
            sortOrder: existing.sortOrder,
            isAvailableForWorkOrder: false,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
        };
    } catch (error: any) {
        if (error?.code === "P2025") {
            throw new WorkTypeNotFoundError();
        }

        if (error?.code === "P2003") {
            throw new WorkTypeDeletionNotAllowedError(
                "Cannot delete work type because active downstream references exist.",
            );
        }

        throw new WorkTypeDeletionError(
            error instanceof Error
                ? error.message
                : "Failed to delete work type record.",
        );
    }
}
