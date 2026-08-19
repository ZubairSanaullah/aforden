import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateDepartmentStatusSchema } from "@/lib/validations/department";
import { DepartmentNotFoundError } from "./departmentErrors";
import type { Department } from "@/generated/prisma/client";

/**
 * Updates a Department's lifecycle status within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Input is validated via Zod (`updateDepartmentStatusSchema`).
 *   - Department lookup is strictly tenant-scoped (`where: { id: departmentId, workspaceId }`).
 *   - Updates ONLY the `status` field, preserving name and description.
 *   - Does NOT modify assigned employees, their EmployeeStatus, or MembershipStatus.
 */
export async function updateDepartmentStatus(
    workspaceId: string,
    departmentId: string,
    input: unknown,
): Promise<Department> {
    // --- Validate Input ---
    const data = updateDepartmentStatusSchema.parse(input);

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

    // --- Execute Status Update ---
    const updated = await prisma.department.update({
        where: {
            id: departmentId,
        },
        data: {
            status: data.status,
        },
    });

    return updated;
}
