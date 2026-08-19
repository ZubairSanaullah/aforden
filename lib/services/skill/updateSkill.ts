import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateSkillSchema } from "@/lib/validations/skill";
import {
    SkillNotFoundError,
    SkillAlreadyExistsError,
} from "./skillErrors";
import type { Skill } from "@/generated/prisma/client";

/**
 * Updates a Skill within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateSkillSchema`).
 *   - Skill lookup is strictly tenant-scoped (`where: { id: skillId, workspaceId }`).
 *   - Enforces unique name within the workspace when updated.
 *   - Preserves omitted fields (undefined) while supporting explicit clearing (null).
 */
export async function updateSkill(
    workspaceId: string,
    skillId: string,
    input: unknown,
): Promise<Skill> {
    // --- Validate Input ---
    const data = updateSkillSchema.parse(input);

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

    // --- Check Name Uniqueness if Changed ---
    if (data.name && data.name !== existing.name) {
        const duplicate = await prisma.skill.findUnique({
            where: {
                workspaceId_name: {
                    workspaceId,
                    name: data.name,
                },
            },
        });

        if (duplicate && duplicate.id !== skillId) {
            throw new SkillAlreadyExistsError();
        }
    }

    // --- Execute Update ---
    const updated = await prisma.skill.update({
        where: {
            id: skillId,
        },
        data,
    });

    return updated;
}
