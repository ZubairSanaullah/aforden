import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { JobTitle } from "@/generated/prisma/client";

/**
 * Retrieves all JobTitles within a workspace, ordered by name ASC.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Query is strictly scoped by `workspaceId`.
 */
export async function getJobTitles(
    workspaceId: string,
): Promise<JobTitle[]> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped List Query ---
    const jobTitles = await prisma.jobTitle.findMany({
        where: {
            workspaceId,
        },
        orderBy: {
            name: "asc",
        },
        include: {
            _count: {
                select: { employees: true },
            },
        },
    });

    return jobTitles;
}
