import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { Department } from "@/generated/prisma/client";

/**
 * Retrieves a single Department by ID within a specific workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookup is strictly scoped by both `id` AND `workspaceId`.
 *   - Returns `Department | null` if not found in the workspace.
 */
export async function getDepartment(
    workspaceId: string,
    departmentId: string,
): Promise<Department | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const department = await prisma.department.findFirst({
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

    return department;
}
