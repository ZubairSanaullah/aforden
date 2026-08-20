import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { changeWorkTypeStatusSchema } from "@/lib/validations/workType";
import {
    WorkTypeNotFoundError,
    WorkTypeUpdateError,
} from "./workTypeErrors";
import type { WorkTypeOperationalReadModel } from "./workType.types";

/**
 * Transitions the operational lifecycle status of a WorkType.
 *
 * Security & Lifecycle Invariants:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_UPDATE permission (OWNER, ADMIN, or MANAGER).
 *   - Target lookup is strictly tenant-scoped (`where: { id: workTypeId, workspaceId }`).
 *   - Updates ONLY `WorkType.status`. Does NOT mutate `ServiceCatalog.status`.
 *   - Returns operational read model with re-evaluated `isAvailableForWorkOrder`.
 */
export async function changeWorkTypeStatus(
    workspaceId: string,
    workTypeId: string,
    input: unknown,
): Promise<WorkTypeOperationalReadModel> {
    // --- 1. Validate Input ---
    const data = changeWorkTypeStatusSchema.parse(input);

    // --- 2. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 3. RBAC: Enforce SERVICE_CATALOG_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_UPDATE,
    );

    // --- 4. Locate Existing WorkType in Workspace ---
    const existing = await prisma.workType.findFirst({
        where: {
            id: workTypeId,
            workspaceId,
        },
        include: {
            catalog: true,
        },
    });

    if (!existing) {
        throw new WorkTypeNotFoundError();
    }

    // --- 5. Persist Status Mutation ---
    try {
        const updated = await prisma.workType.update({
            where: {
                id: workTypeId,
            },
            data: {
                status: data.status,
            },
            include: {
                catalog: true,
            },
        });

        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            catalogId: updated.catalogId,
            catalogName: updated.catalog.name,
            catalogStatus: updated.catalog.status,
            name: updated.name,
            code: updated.code,
            description: updated.description,
            estimatedDuration: updated.estimatedDuration,
            status: updated.status,
            sortOrder: updated.sortOrder,
            isAvailableForWorkOrder:
                updated.status === "ACTIVE" &&
                updated.catalog.status === "ACTIVE",
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        };
    } catch (error: any) {
        throw new WorkTypeUpdateError(
            error instanceof Error
                ? error.message
                : "Failed to update work type status.",
        );
    }
}

export const updateWorkTypeStatus = changeWorkTypeStatus;
