import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    DepartmentNotFoundError,
    DepartmentHasAssignedEmployeesError,
} from "./departmentErrors";
import type { Department } from "@/generated/prisma/client";

/**
 * Deletes a Department from a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_REMOVE permission (OWNER or ADMIN).
 *   - Department lookup is strictly tenant-scoped (`where: { id: departmentId, workspaceId }`).
 *   - Prevents deletion if employees are currently assigned to the department (`DepartmentHasAssignedEmployeesError`).
 *   - Deleting a department NEVER deletes Employee records.
 */
export async function deleteDepartment(
    workspaceId: string,
    departmentId: string,
): Promise<Department> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_REMOVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_REMOVE,
    );

    // --- Verify Department Exists in Workspace ---
    const existing = await prisma.department.findFirst({
        where: {
            id: departmentId,
            workspaceId,
        },
        include: {
            _count: {
                select: { employees: true },
            },
        },
    });

    if (!existing) {
        throw new DepartmentNotFoundError();
    }

    // --- Enforce: Reject deletion if employees are assigned ---
    if (existing._count.employees > 0) {
        throw new DepartmentHasAssignedEmployeesError(
            "Cannot delete department while employees are assigned to it.",
        );
    }

    // --- Execute Deletion ---
    const deleted = await prisma.department.delete({
        where: {
            id: departmentId,
        },
    });

    return deleted;
}
