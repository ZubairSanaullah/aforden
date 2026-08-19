import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateJobTitleStatusSchema } from "@/lib/validations/jobTitle";
import { JobTitleNotFoundError } from "./jobTitleErrors";
import type { JobTitle } from "@/generated/prisma/client";

/**
 * Updates a JobTitle's lifecycle status within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Input is validated via Zod (`updateJobTitleStatusSchema`).
 *   - JobTitle lookup is strictly tenant-scoped (`where: { id: jobTitleId, workspaceId }`).
 *   - Updates ONLY the `status` field, preserving name and description.
 *   - Does NOT modify assigned employees, their EmployeeStatus, or MembershipStatus.
 */
export async function updateJobTitleStatus(
    workspaceId: string,
    jobTitleId: string,
    input: unknown,
): Promise<JobTitle> {
    // --- Validate Input ---
    const data = updateJobTitleStatusSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify JobTitle Exists in Workspace ---
    const existing = await prisma.jobTitle.findFirst({
        where: {
            id: jobTitleId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new JobTitleNotFoundError();
    }

    // --- Execute Status Update ---
    const updated = await prisma.jobTitle.update({
        where: {
            id: jobTitleId,
        },
        data: {
            status: data.status,
        },
    });

    return updated;
}
