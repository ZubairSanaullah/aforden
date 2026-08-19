import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { TechnicianServiceAreaNotFoundError } from "./technicianServiceAreaErrors";
import type { TechnicianServiceArea } from "@/generated/prisma/client";

/**
 * Removes a ServiceArea assignment from a TechnicianProfile within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_REMOVE permission (OWNER or ADMIN).
 *   - Lookup is strictly tenant-scoped (`where: { id: technicianServiceAreaId, technicianProfile: { employee: { workspaceId } } }`).
 *   - Removing a TechnicianServiceArea NEVER deletes TechnicianProfile, Employee, or ServiceArea records.
 */
export async function removeServiceAreaFromTechnician(
    workspaceId: string,
    technicianServiceAreaId: string,
): Promise<TechnicianServiceArea> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_REMOVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_REMOVE,
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

    // --- Execute Deletion ---
    const deleted = await prisma.technicianServiceArea.delete({
        where: {
            id: technicianServiceAreaId,
        },
    });

    return deleted;
}
