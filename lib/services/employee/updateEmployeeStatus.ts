import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateEmployeeStatusSchema } from "@/lib/validations/employee";
import { EmployeeNotFoundError } from "./employeeErrors";
import type { Employee } from "@/generated/prisma/client";

/**
 * Updates an Employee's employment status within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Input is validated via Zod (`updateEmployeeStatusSchema`).
 *   - Target employee lookup is strictly tenant-scoped (`where: { id: employeeId, workspaceId }`).
 *   - Updates ONLY the `status` field, preserving all other employee profile information.
 *   - Completely independent from MembershipStatus (system access) and UserStatus (auth lifecycle).
 */
export async function updateEmployeeStatus(
    workspaceId: string,
    employeeId: string,
    input: unknown,
): Promise<Employee> {
    // --- Validate Input ---
    const data = updateEmployeeStatusSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
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

    // --- Execute Status Update (Preserves all other fields) ---
    const updated = await prisma.employee.update({
        where: {
            id: employeeId,
        },
        data: {
            status: data.status,
        },
    });

    return updated;
}
