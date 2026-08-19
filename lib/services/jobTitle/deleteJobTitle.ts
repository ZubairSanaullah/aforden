import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    JobTitleNotFoundError,
    JobTitleHasAssignedEmployeesError,
} from "./jobTitleErrors";
import type { JobTitle } from "@/generated/prisma/client";

/**
 * Deletes a JobTitle from a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_REMOVE permission (OWNER or ADMIN).
 *   - JobTitle lookup is strictly tenant-scoped (`where: { id: jobTitleId, workspaceId }`).
 *   - Prevents deletion if employees are currently assigned to the job title (`JobTitleHasAssignedEmployeesError`).
 *   - Deleting a job title NEVER deletes Employee records.
 */
export async function deleteJobTitle(
    workspaceId: string,
    jobTitleId: string,
): Promise<JobTitle> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_REMOVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_REMOVE,
    );

    // --- Verify JobTitle Exists in Workspace ---
    const existing = await prisma.jobTitle.findFirst({
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

    if (!existing) {
        throw new JobTitleNotFoundError();
    }

    // --- Enforce: Reject deletion if employees are assigned ---
    if (existing._count.employees > 0) {
        throw new JobTitleHasAssignedEmployeesError(
            "Cannot delete job title while employees are assigned to it.",
        );
    }

    // --- Execute Deletion ---
    const deleted = await prisma.jobTitle.delete({
        where: {
            id: jobTitleId,
        },
    });

    return deleted;
}
