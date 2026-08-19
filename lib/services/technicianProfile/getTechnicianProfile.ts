import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { TechnicianProfile, Employee } from "@/generated/prisma/client";

export type TechnicianProfileWithEmployee = TechnicianProfile & {
    employee: Employee;
};

/**
 * Retrieves a single TechnicianProfile by ID within a specific workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookup is strictly scoped by `employee.workspaceId`.
 *   - Returns `TechnicianProfileWithEmployee | null` if not found in workspace.
 */
export async function getTechnicianProfile(
    workspaceId: string,
    technicianProfileId: string,
): Promise<TechnicianProfileWithEmployee | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const profile = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
        include: {
            employee: true,
        },
    });

    return profile;
}
