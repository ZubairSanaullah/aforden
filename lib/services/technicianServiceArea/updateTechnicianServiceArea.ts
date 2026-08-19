import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateTechnicianServiceAreaSchema } from "@/lib/validations/technicianServiceArea";
import { TechnicianServiceAreaNotFoundError } from "./technicianServiceAreaErrors";
import type { TechnicianServiceArea, ServiceArea } from "@/generated/prisma/client";

export type TechnicianServiceAreaWithServiceArea = TechnicianServiceArea & {
    serviceArea: ServiceArea;
};

/**
 * Updates a TechnicianServiceArea assignment details (notes).
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateTechnicianServiceAreaSchema`).
 *   - Lookup is strictly tenant-scoped (`where: { id: technicianServiceAreaId, technicianProfile: { employee: { workspaceId } } }`).
 *   - Existing assignments to inactive service areas remain updateable.
 */
export async function updateTechnicianServiceArea(
    workspaceId: string,
    technicianServiceAreaId: string,
    input: unknown,
): Promise<TechnicianServiceAreaWithServiceArea> {
    // --- Validate Input ---
    const data = updateTechnicianServiceAreaSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify TechnicianServiceArea Exists in Workspace ---
    const existing = await prisma.technicianServiceArea.findFirst({
        where: {
            id: technicianServiceAreaId,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
    });

    if (!existing) {
        throw new TechnicianServiceAreaNotFoundError();
    }

    // --- Execute Update ---
    const updated = await prisma.technicianServiceArea.update({
        where: {
            id: technicianServiceAreaId,
        },
        data,
        include: {
            serviceArea: true,
        },
    });

    return updated;
}
