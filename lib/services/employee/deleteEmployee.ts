import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { EmployeeNotFoundError } from "./employeeErrors";
import type { Employee } from "@/generated/prisma/client";

/**
 * Deletes an Employee profile from a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_REMOVE permission (OWNER or ADMIN).
 *   - Employee lookup is strictly tenant-scoped (`where: { id: employeeId, workspaceId }`).
 *   - Deleting the Employee profile removes ONLY the Employee record.
 *     It does NOT delete the parent WorkspaceMember, User, or Workspace.
 */
export async function deleteEmployee(
    workspaceId: string,
    employeeId: string,
): Promise<Employee> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_REMOVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_REMOVE,
    );

    // --- Verify Employee Exists in Workspace ---
    const existing = await prisma.employee.findFirst({
        where: {
            id: employeeId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new EmployeeNotFoundError();
    }

    // --- Execute Deletion ---
    const deleted = await prisma.employee.delete({
        where: {
            id: employeeId,
        },
    });

    return deleted;
}
