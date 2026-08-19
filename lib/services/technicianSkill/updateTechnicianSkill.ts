import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateTechnicianSkillSchema } from "@/lib/validations/technicianSkill";
import { TechnicianSkillNotFoundError } from "./technicianSkillErrors";
import type { TechnicianSkill, Skill } from "@/generated/prisma/client";

export type TechnicianSkillWithSkill = TechnicianSkill & {
    skill: Skill;
};

/**
 * Updates a TechnicianSkill assignment details (proficiency, experience, notes).
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateTechnicianSkillSchema`).
 *   - Lookup is strictly tenant-scoped (`where: { id: technicianSkillId, technicianProfile: { employee: { workspaceId } } }`).
 *   - Existing assignments to inactive skills remain updateable.
 */
export async function updateTechnicianSkill(
    workspaceId: string,
    technicianSkillId: string,
    input: unknown,
): Promise<TechnicianSkillWithSkill> {
    // --- Validate Input ---
    const data = updateTechnicianSkillSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
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

    // --- Execute Update ---
    const updated = await prisma.technicianSkill.update({
        where: {
            id: technicianSkillId,
        },
        data,
        include: {
            skill: true,
        },
    });

    return updated;
}
