import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateEmployeeSchema } from "@/lib/validations/employee";
import {
    EmployeeNotFoundError,
    DuplicateEmployeeNumberError,
} from "./employeeErrors";
import { InvalidDepartmentError } from "@/lib/services/department/departmentErrors";
import {
    InvalidJobTitleError,
    InactiveJobTitleAssignmentError,
} from "@/lib/services/jobTitle/jobTitleErrors";
import type { Employee } from "@/generated/prisma/client";

/**
 * Updates an Employee profile within a specific workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateEmployeeSchema`).
 *   - Employee lookup is strictly tenant-scoped (`where: { id: employeeId, workspaceId }`).
 *   - Distinguishes between omitted/undefined fields (not modified) and null (cleared).
 *   - Enforces uniqueness of `employeeNumber` within the workspace when updated.
 *   - If `departmentId` is provided, ensures department belongs to the same workspace.
 *   - If `jobTitleId` is provided, ensures job title belongs to workspace and new assignments are not INACTIVE.
 */
export async function updateEmployee(
    workspaceId: string,
    employeeId: string,
    input: unknown,
): Promise<Employee> {
    // --- Validate Input ---
    const data = updateEmployeeSchema.parse(input);

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

    // --- Check Employee Number Uniqueness if Changed ---
    if (data.employeeNumber && data.employeeNumber !== existing.employeeNumber) {
        const existingWithNumber = await prisma.employee.findUnique({
            where: {
                workspaceId_employeeNumber: {
                    workspaceId,
                    employeeNumber: data.employeeNumber,
                },
            },
        });

        if (existingWithNumber && existingWithNumber.id !== employeeId) {
            throw new DuplicateEmployeeNumberError();
        }
    }

    // --- Verify Department Belongs to Workspace if Provided ---
    if (data.departmentId) {
        const dept = await prisma.department.findFirst({
            where: {
                id: data.departmentId,
                workspaceId,
            },
        });

        if (!dept) {
            throw new InvalidDepartmentError(
                "Department not found or does not belong to this workspace.",
            );
        }
    }

    // --- Verify JobTitle Belongs to Workspace and New Assignment is Active ---
    if (data.jobTitleId && data.jobTitleId !== existing.jobTitleId) {
        const jobTitle = await prisma.jobTitle.findFirst({
            where: {
                id: data.jobTitleId,
                workspaceId,
            },
        });

        if (!jobTitle) {
            throw new InvalidJobTitleError(
                "Job title not found or does not belong to this workspace.",
            );
        }

        if (jobTitle.status === "INACTIVE") {
            throw new InactiveJobTitleAssignmentError(
                "Cannot assign an inactive job title.",
            );
        }
    }

    // --- Execute Update (Preserves undefined vs null semantics) ---
    const updated = await prisma.employee.update({
        where: {
            id: employeeId,
        },
        data,
    });

    return updated;
}
