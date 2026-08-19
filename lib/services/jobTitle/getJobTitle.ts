import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { JobTitle } from "@/generated/prisma/client";

/**
 * Retrieves a single JobTitle by ID within a specific workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookup is strictly scoped by both `id` AND `workspaceId`.
 *   - Returns `JobTitle | null` if not found in the workspace.
 */
export async function getJobTitle(
    workspaceId: string,
    jobTitleId: string,
): Promise<JobTitle | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const jobTitle = await prisma.jobTitle.findFirst({
        where: {
            id: jobTitleId,
            workspaceId,
        },
        include: {
            _count: {
                select: { employees: true },
            },
        },
    });

    return jobTitle;
}
