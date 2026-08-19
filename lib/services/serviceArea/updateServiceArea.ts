import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateServiceAreaSchema } from "@/lib/validations/serviceArea";
import {
    ServiceAreaNotFoundError,
    ServiceAreaAlreadyExistsError,
} from "./serviceAreaErrors";
import type { ServiceArea } from "@/generated/prisma/client";

/**
 * Updates a ServiceArea within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateServiceAreaSchema`).
 *   - ServiceArea lookup is strictly tenant-scoped (`where: { id: serviceAreaId, workspaceId }`).
 *   - Enforces unique name within the workspace when updated.
 *   - Preserves omitted fields (undefined) while supporting explicit clearing (null).
 */
export async function updateServiceArea(
    workspaceId: string,
    serviceAreaId: string,
    input: unknown,
): Promise<ServiceArea> {
    // --- Validate Input ---
    const data = updateServiceAreaSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify ServiceArea Exists in Workspace ---
    const existing = await prisma.serviceArea.findFirst({
        where: {
            id: serviceAreaId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new ServiceAreaNotFoundError();
    }

    // --- Check Name Uniqueness if Changed ---
    if (data.name && data.name !== existing.name) {
        const duplicate = await prisma.serviceArea.findUnique({
            where: {
                workspaceId_name: {
                    workspaceId,
                    name: data.name,
                },
            },
        });

        if (duplicate && duplicate.id !== serviceAreaId) {
            throw new ServiceAreaAlreadyExistsError();
        }
    }

    // --- Execute Update ---
    const updated = await prisma.serviceArea.update({
        where: {
            id: serviceAreaId,
        },
        data,
    });

    return updated;
}
