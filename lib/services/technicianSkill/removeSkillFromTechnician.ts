import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { TechnicianSkillNotFoundError } from "./technicianSkillErrors";
import type { TechnicianSkill } from "@/generated/prisma/client";

/**
 * Removes a Skill assignment from a TechnicianProfile within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_REMOVE permission (OWNER or ADMIN).
 *   - Lookup is strictly tenant-scoped (`where: { id: technicianSkillId, technicianProfile: { employee: { workspaceId } } }`).
 *   - Removing a TechnicianSkill NEVER deletes TechnicianProfile, Employee, or Skill records.
 */
export async function removeSkillFromTechnician(
    workspaceId: string,
    technicianSkillId: string,
): Promise<TechnicianSkill> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_REMOVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_REMOVE,
    );

    // --- Verify TechnicianSkill Exists in Workspace ---
    const existing = await prisma.technicianSkill.findFirst({
        where: {
            id: technicianSkillId,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
    });

    if (!existing) {
        throw new TechnicianSkillNotFoundError();
    }

    // --- Execute Deletion ---
    const deleted = await prisma.technicianSkill.delete({
        where: {
            id: technicianSkillId,
        },
    });

    return deleted;
}
