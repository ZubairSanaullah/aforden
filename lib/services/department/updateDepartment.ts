import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateDepartmentSchema } from "@/lib/validations/department";
import {
    DepartmentNotFoundError,
    DepartmentAlreadyExistsError,
} from "./departmentErrors";
import type { Department } from "@/generated/prisma/client";

/**
 * Updates a Department within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateDepartmentSchema`).
 *   - Department lookup is strictly tenant-scoped (`where: { id: departmentId, workspaceId }`).
 *   - Enforces unique name within the workspace when updated.
 *   - Preserves omitted fields (undefined) while supporting explicit clearing (null).
 */
export async function updateDepartment(
    workspaceId: string,
    departmentId: string,
    input: unknown,
): Promise<Department> {
    // --- Validate Input ---
    const data = updateDepartmentSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify Department Exists in Workspace ---
    const existing = await prisma.department.findFirst({
        where: {
            id: departmentId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new DepartmentNotFoundError();
    }

    // --- Check Name Uniqueness if Changed ---
    if (data.name && data.name !== existing.name) {
        const duplicate = await prisma.department.findUnique({
            where: {
                workspaceId_name: {
                    workspaceId,
                    name: data.name,
                },
            },
        });

        if (duplicate && duplicate.id !== departmentId) {
            throw new DepartmentAlreadyExistsError();
        }
    }

    // --- Execute Update ---
    const updated = await prisma.department.update({
        where: {
            id: departmentId,
        },
        data,
    });

    return updated;
}
