import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateJobTitleSchema } from "@/lib/validations/jobTitle";
import {
    JobTitleNotFoundError,
    JobTitleAlreadyExistsError,
} from "./jobTitleErrors";
import type { JobTitle } from "@/generated/prisma/client";

/**
 * Updates a JobTitle within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateJobTitleSchema`).
 *   - JobTitle lookup is strictly tenant-scoped (`where: { id: jobTitleId, workspaceId }`).
 *   - Enforces unique name within the workspace when updated.
 *   - Preserves omitted fields (undefined) while supporting explicit clearing (null).
 */
export async function updateJobTitle(
    workspaceId: string,
    jobTitleId: string,
    input: unknown,
): Promise<JobTitle> {
    // --- Validate Input ---
    const data = updateJobTitleSchema.parse(input);

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

    // --- Check Name Uniqueness if Changed ---
    if (data.name && data.name !== existing.name) {
        const duplicate = await prisma.jobTitle.findUnique({
            where: {
                workspaceId_name: {
                    workspaceId,
                    name: data.name,
                },
            },
        });

        if (duplicate && duplicate.id !== jobTitleId) {
            throw new JobTitleAlreadyExistsError();
        }
    }

    // --- Execute Update ---
    const updated = await prisma.jobTitle.update({
        where: {
            id: jobTitleId,
        },
        data,
    });

    return updated;
}
