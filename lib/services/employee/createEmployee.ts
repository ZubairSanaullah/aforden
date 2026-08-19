import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createEmployeeSchema } from "@/lib/validations/employee";
import {
    EmployeeAlreadyExistsError,
    WorkspaceMemberNotFoundError,
    InvalidWorkspaceMemberError,
    DuplicateEmployeeNumberError,
} from "./employeeErrors";
import { InvalidDepartmentError } from "@/lib/services/department/departmentErrors";
import {
    InvalidJobTitleError,
    InactiveJobTitleAssignmentError,
} from "@/lib/services/jobTitle/jobTitleErrors";
import type { Employee } from "@/generated/prisma/client";

/**
 * Creates an Employee profile for an existing WorkspaceMember in a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`createEmployeeSchema`).
 *   - Target WorkspaceMember must exist and belong to `workspaceId`.
 *   - Enforces 1:1 member ↔ employee cardinality (rejects duplicate employee profile).
 *   - Enforces uniqueness of `employeeNumber` within the workspace.
 *   - If `departmentId` is provided, ensures department belongs to the same workspace.
 *   - If `jobTitleId` is provided, ensures job title belongs to workspace and is ACTIVE.
 */
export async function createEmployee(
    workspaceId: string,
    workspaceMemberId: string,
    input: unknown,
): Promise<Employee> {
    // --- Validate Input ---
    const data = createEmployeeSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify Target WorkspaceMember ---
    const member = await prisma.workspaceMember.findUnique({
        where: { id: workspaceMemberId },
        include: { employee: true },
    });

    if (!member) {
        throw new WorkspaceMemberNotFoundError();
    }

    if (member.workspaceId !== workspaceId) {
        throw new InvalidWorkspaceMemberError(
            "Workspace member does not belong to this workspace.",
        );
    }

    if (member.employee) {
        throw new EmployeeAlreadyExistsError(
            "This workspace member already has an employee profile.",
        );
    }

    // --- Verify Scoped Employee Number Uniqueness ---
    if (data.employeeNumber) {
        const existingWithNumber = await prisma.employee.findUnique({
            where: {
                workspaceId_employeeNumber: {
                    workspaceId,
                    employeeNumber: data.employeeNumber,
                },
            },
        });

        if (existingWithNumber) {
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

    // --- Verify JobTitle Belongs to Workspace and is Active if Provided ---
    if (data.jobTitleId) {
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

    // --- Create Employee Record ---
    const employee = await prisma.employee.create({
        data: {
            workspaceId,
            workspaceMemberId,
            departmentId: data.departmentId ?? null,
            jobTitleId: data.jobTitleId ?? null,
            employeeNumber: data.employeeNumber ?? null,
            displayName: data.displayName ?? null,
            phone: data.phone ?? null,
            hireDate: data.hireDate ?? null,
            status: data.status,
            notes: data.notes ?? null,
        },
    });

    return employee;
}
