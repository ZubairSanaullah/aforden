import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { Employee } from "@/generated/prisma/client";

/**
 * Retrieves a single Employee profile by ID within a specific workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Query is strictly scoped by both `id` AND `workspaceId`.
 *   - Returns `Employee | null` if not found in the workspace.
 */
export async function getEmployee(
    workspaceId: string,
    employeeId: string,
): Promise<Employee | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const employee = await prisma.employee.findFirst({
        where: {
            id: employeeId,
            workspaceId,
        },
        include: {
            workspaceMember: {
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            avatarUrl: true,
                        },
                    },
                },
            },
        },
    });

    return employee;
}
