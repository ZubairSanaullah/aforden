import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { InvalidTechnicianProfileError } from "./technicianSkillErrors";
import type { TechnicianSkill, Skill } from "@/generated/prisma/client";

export type TechnicianSkillItem = TechnicianSkill & {
    skill: Skill;
};

/**
 * Retrieves all Skills assigned to a TechnicianProfile within a workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Verifies TechnicianProfile belongs to the target workspace (`InvalidTechnicianProfileError`).
 *   - Returns list ordered by `skill.name ASC`.
 */
export async function getTechnicianSkills(
    workspaceId: string,
    technicianProfileId: string,
): Promise<TechnicianSkillItem[]> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Verify TechnicianProfile Exists in Workspace ---
    const profile = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
    });

    if (!profile) {
        throw new InvalidTechnicianProfileError();
    }

    // --- Tenant-Scoped List Query ---
    const technicianSkills = await prisma.technicianSkill.findMany({
        where: {
            technicianProfileId,
        },
        orderBy: {
            skill: {
                name: "asc",
            },
        },
        include: {
            skill: true,
        },
    });

    return technicianSkills;
}
