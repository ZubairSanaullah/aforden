import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { Skill } from "@/generated/prisma/client";

/**
 * Retrieves a single Skill by ID within a specific workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookup is strictly scoped by both `id` AND `workspaceId`.
 *   - Returns `Skill | null` if not found in workspace.
 */
export async function getSkill(
    workspaceId: string,
    skillId: string,
): Promise<Skill | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const skill = await prisma.skill.findFirst({
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

    return skill;
}
