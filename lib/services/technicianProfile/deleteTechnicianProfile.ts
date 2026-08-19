import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { TechnicianProfileNotFoundError } from "./technicianProfileErrors";
import type { TechnicianProfile } from "@/generated/prisma/client";

/**
 * Deletes a TechnicianProfile within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_REMOVE permission (OWNER or ADMIN).
 *   - Profile lookup is strictly tenant-scoped (`where: { id: technicianProfileId, employee: { workspaceId } }`).
 *   - Deleting a TechnicianProfile NEVER deletes Employee, WorkspaceMember, User, or Workspace.
 */
export async function deleteTechnicianProfile(
    workspaceId: string,
    technicianProfileId: string,
): Promise<TechnicianProfile> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_REMOVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_REMOVE,
    );

    // --- Verify TechnicianProfile Exists in Workspace ---
    const existing = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
    });

    if (!existing) {
        throw new TechnicianProfileNotFoundError();
    }

    // --- Execute Deletion ---
    const deleted = await prisma.technicianProfile.delete({
        where: {
            id: technicianProfileId,
        },
    });

    return deleted;
}
