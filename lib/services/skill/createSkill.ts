import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createSkillSchema } from "@/lib/validations/skill";
import { SkillAlreadyExistsError } from "./skillErrors";
import type { Skill } from "@/generated/prisma/client";

/**
 * Creates a reusable Skill within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`createSkillSchema`).
 *   - Skill name is unique within the workspace (`@@unique([workspaceId, name])`).
 *   - Skill is strictly created within `workspaceId`.
 */
export async function createSkill(
    workspaceId: string,
    input: unknown,
): Promise<Skill> {
    // --- Validate Input ---
    const data = createSkillSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify Scoped Name Uniqueness ---
    const existing = await prisma.skill.findUnique({
        where: {
            workspaceId_name: {
                workspaceId,
                name: data.name,
            },
        },
    });

    if (existing) {
        throw new SkillAlreadyExistsError();
    }

    // --- Create Skill ---
    const skill = await prisma.skill.create({
        data: {
            workspaceId,
            name: data.name,
            description: data.description ?? null,
            status: data.status,
        },
    });

    return skill;
}
