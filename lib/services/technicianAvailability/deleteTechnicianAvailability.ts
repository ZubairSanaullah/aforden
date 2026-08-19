import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { TechnicianAvailabilityNotFoundError } from "./technicianAvailabilityErrors";
import type { TechnicianAvailability } from "@/generated/prisma/client";

/**
 * Deletes a TechnicianAvailability record within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_REMOVE permission (OWNER or ADMIN).
 *   - Lookup is strictly tenant-scoped (`where: { id: availabilityId, technicianProfile: { employee: { workspaceId } } }`).
 *   - Deleting an availability record NEVER deletes TechnicianProfile, Employee, or User records.
 */
export async function deleteTechnicianAvailability(
    workspaceId: string,
    availabilityId: string,
): Promise<TechnicianAvailability> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_REMOVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_REMOVE,
    );

    // --- Verify TechnicianAvailability Exists in Workspace ---
    const existing = await prisma.technicianAvailability.findFirst({
        where: {
            id: availabilityId,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
    });

    if (!existing) {
        throw new TechnicianAvailabilityNotFoundError();
    }

    // --- Execute Deletion ---
    const deleted = await prisma.technicianAvailability.delete({
        where: {
            id: availabilityId,
        },
    });

    return deleted;
}
