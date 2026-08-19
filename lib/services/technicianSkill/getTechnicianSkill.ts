import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { TechnicianSkill, Skill, TechnicianProfile } from "@/generated/prisma/client";

export type TechnicianSkillDetails = TechnicianSkill & {
    skill: Skill;
    technicianProfile: TechnicianProfile;
};

/**
 * Retrieves a single TechnicianSkill assignment by ID within a specific workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookup is strictly scoped by `technicianProfile.employee.workspaceId`.
 *   - Returns `TechnicianSkillDetails | null` if not found in workspace.
 */
export async function getTechnicianSkill(
    workspaceId: string,
    technicianSkillId: string,
): Promise<TechnicianSkillDetails | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const technicianSkill = await prisma.technicianSkill.findFirst({
        where: {
            id: technicianSkillId,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
        include: {
            skill: true,
            technicianProfile: true,
        },
    });

    return technicianSkill;
}
