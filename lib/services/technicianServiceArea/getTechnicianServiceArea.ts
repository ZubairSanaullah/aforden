import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { TechnicianServiceArea, ServiceArea, TechnicianProfile } from "@/generated/prisma/client";

export type TechnicianServiceAreaDetails = TechnicianServiceArea & {
    serviceArea: ServiceArea;
    technicianProfile: TechnicianProfile;
};

/**
 * Retrieves a single TechnicianServiceArea assignment by ID within a specific workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookup is strictly scoped by `technicianProfile.employee.workspaceId`.
 *   - Returns `TechnicianServiceAreaDetails | null` if not found in workspace.
 */
export async function getTechnicianServiceArea(
    workspaceId: string,
    technicianServiceAreaId: string,
): Promise<TechnicianServiceAreaDetails | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const technicianServiceArea = await prisma.technicianServiceArea.findFirst({
        where: {
            id: technicianServiceAreaId,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
        include: {
            serviceArea: true,
            technicianProfile: true,
        },
    });

    return technicianServiceArea;
}
