import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createDepartmentSchema } from "@/lib/validations/department";
import { DepartmentAlreadyExistsError } from "./departmentErrors";
import type { Department } from "@/generated/prisma/client";

/**
 * Creates a Department within a specific workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`createDepartmentSchema`).
 *   - Department name is unique within the workspace (`@@unique([workspaceId, name])`).
 *   - Department is strictly created within `workspaceId`.
 */
export async function createDepartment(
    workspaceId: string,
    input: unknown,
): Promise<Department> {
    // --- Validate Input ---
    const data = createDepartmentSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify Scoped Name Uniqueness ---
    const existing = await prisma.department.findUnique({
        where: {
            workspaceId_name: {
                workspaceId,
                name: data.name,
            },
        },
    });

    if (existing) {
        throw new DepartmentAlreadyExistsError();
    }

    // --- Create Department ---
    const department = await prisma.department.create({
        data: {
            workspaceId,
            name: data.name,
            description: data.description ?? null,
            status: data.status,
        },
    });

    return department;
}
