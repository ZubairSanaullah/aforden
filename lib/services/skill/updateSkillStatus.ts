import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateSkillStatusSchema } from "@/lib/validations/skill";
import { SkillNotFoundError } from "./skillErrors";
import type { Skill } from "@/generated/prisma/client";

/**
 * Updates a Skill's lifecycle status within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Input is validated via Zod (`updateSkillStatusSchema`).
 *   - Skill lookup is strictly tenant-scoped (`where: { id: skillId, workspaceId }`).
 *   - Updates ONLY the `status` field, preserving name and description.
 *   - Does NOT modify assigned technicians, their EmployeeStatus, or MembershipStatus.
 */
export async function updateSkillStatus(
    workspaceId: string,
    skillId: string,
    input: unknown,
): Promise<Skill> {
    // --- Validate Input ---
    const data = updateSkillStatusSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify Skill Exists in Workspace ---
    const existing = await prisma.skill.findFirst({
        where: {
            id: skillId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new SkillNotFoundError();
    }

    // --- Execute Status Update ---
    const updated = await prisma.skill.update({
        where: {
            id: skillId,
        },
        data: {
            status: data.status,
        },
    });

    return updated;
}
