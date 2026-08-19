import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    SkillNotFoundError,
    SkillHasAssignedTechniciansError,
} from "./skillErrors";
import type { Skill } from "@/generated/prisma/client";

/**
 * Deletes a Skill from a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_REMOVE permission (OWNER or ADMIN).
 *   - Skill lookup is strictly tenant-scoped (`where: { id: skillId, workspaceId }`).
 *   - Prevents deletion if technicians are currently assigned to the skill (`SkillHasAssignedTechniciansError`).
 *   - Deleting a skill NEVER deletes TechnicianProfile, Employee, or User records.
 */
export async function deleteSkill(
    workspaceId: string,
    skillId: string,
): Promise<Skill> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_REMOVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_REMOVE,
    );

    // --- Verify Skill Exists in Workspace ---
    const existing = await prisma.skill.findFirst({
        where: {
            id: skillId,
            workspaceId,
        },
        include: {
            _count: {
                select: { technicianSkills: true },
            },
        },
    });

    if (!existing) {
        throw new SkillNotFoundError();
    }

    // --- Enforce: Reject deletion if technicians are assigned ---
    if (existing._count.technicianSkills > 0) {
        throw new SkillHasAssignedTechniciansError(
            "Cannot delete skill while technicians are assigned to it.",
        );
    }

    // --- Execute Deletion ---
    const deleted = await prisma.skill.delete({
        where: {
            id: skillId,
        },
    });

    return deleted;
}
