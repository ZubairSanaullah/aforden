import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateWorkTypeSchema } from "@/lib/validations/workType";
import { ServiceCatalogNotFoundError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import {
    WorkTypeNotFoundError,
    DuplicateWorkTypeNameError,
    DuplicateWorkTypeCodeError,
    WorkTypeUpdateError,
} from "./workTypeErrors";
import type { WorkTypeOperationalReadModel } from "./workType.types";

/**
 * Updates editable definition fields of a WorkType within an authorized workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_UPDATE permission (OWNER, ADMIN, or MANAGER).
 *   - Inputs are validated via Zod (`updateWorkTypeSchema`).
 *   - Cannot modify `id`, `workspaceId`, `status`, or audit timestamps through general update.
 *   - Target lookup is strictly tenant-scoped (`where: { id: workTypeId, workspaceId }`).
 *   - Reparenting Safety: If `catalogId` changes, verifies that target catalog belongs to SAME `workspaceId`.
 *   - Catches P2002 unique constraint collisions on `[catalogId, name]` and `[workspaceId, code]`.
 *   - Returns operational read model with computed `isAvailableForWorkOrder`.
 */
export async function updateWorkType(
    workspaceId: string,
    workTypeId: string,
    input: unknown,
): Promise<WorkTypeOperationalReadModel> {
    // --- 1. Validate Input ---
    const data = updateWorkTypeSchema.parse(input);

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

    // --- 5. Reparenting Invariant: Verify Target Catalog Exists in Same Workspace ---
    if (data.catalogId && data.catalogId !== existing.catalogId) {
        const targetCatalog = await prisma.serviceCatalog.findFirst({
            where: {
                id: data.catalogId,
                workspaceId,
            },
        });

        if (!targetCatalog) {
            throw new ServiceCatalogNotFoundError();
        }
    }

    // --- 6. Persist Updates with Concurrency Protection ---
    try {
        const updated = await prisma.workType.update({
            where: {
                id: workTypeId,
            },
            data: {
                ...(data.catalogId !== undefined && { catalogId: data.catalogId }),
                ...(data.name !== undefined && { name: data.name }),
                ...(data.code !== undefined && { code: data.code }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.estimatedDuration !== undefined && { estimatedDuration: data.estimatedDuration }),
                ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
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
        const isUnique =
            error?.code === "P2002" ||
            (typeof error?.message === "string" &&
                error.message.includes("Unique constraint failed"));

        if (isUnique) {
            const target =
                error?.meta?.target ||
                (typeof error?.message === "string" ? error.message : "");

            if (Array.isArray(target)) {
                if (target.includes("code")) {
                    throw new DuplicateWorkTypeCodeError();
                }
                if (target.includes("name") || target.includes("catalogId")) {
                    throw new DuplicateWorkTypeNameError();
                }
            } else if (typeof target === "string") {
                if (target.includes("code")) {
                    throw new DuplicateWorkTypeCodeError();
                }
                if (target.includes("name")) {
                    throw new DuplicateWorkTypeNameError();
                }
            }

            if (data.code !== undefined && data.code !== null) {
                const existingCode = await prisma.workType.findFirst({
                    where: {
                        workspaceId,
                        code: data.code,
                        NOT: { id: workTypeId },
                    },
                });
                if (existingCode) {
                    throw new DuplicateWorkTypeCodeError();
                }
            }

            throw new DuplicateWorkTypeNameError();
        }

        throw new WorkTypeUpdateError(
            error instanceof Error
                ? error.message
                : "Failed to update work type record.",
        );
    }
}
