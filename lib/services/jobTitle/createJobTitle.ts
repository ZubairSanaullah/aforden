import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createJobTitleSchema } from "@/lib/validations/jobTitle";
import { JobTitleAlreadyExistsError } from "./jobTitleErrors";
import type { JobTitle } from "@/generated/prisma/client";

/**
 * Creates a JobTitle within a specific workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`createJobTitleSchema`).
 *   - JobTitle name is unique within the workspace (`@@unique([workspaceId, name])`).
 *   - JobTitle is strictly created within `workspaceId`.
 */
export async function createJobTitle(
    workspaceId: string,
    input: unknown,
): Promise<JobTitle> {
    // --- Validate Input ---
    const data = createJobTitleSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify Scoped Name Uniqueness ---
    const existing = await prisma.jobTitle.findUnique({
        where: {
            workspaceId_name: {
                workspaceId,
                name: data.name,
            },
        },
    });

    if (existing) {
        throw new JobTitleAlreadyExistsError();
    }

    // --- Create JobTitle ---
    const jobTitle = await prisma.jobTitle.create({
        data: {
            workspaceId,
            name: data.name,
            description: data.description ?? null,
            status: data.status,
        },
    });

    return jobTitle;
}
