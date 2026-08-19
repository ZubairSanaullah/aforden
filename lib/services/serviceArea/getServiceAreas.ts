import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { ServiceArea } from "@/generated/prisma/client";

/**
 * Retrieves all ServiceAreas within a workspace, ordered by name ASC.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Query is strictly scoped by `workspaceId`.
 */
export async function getServiceAreas(
    workspaceId: string,
): Promise<ServiceArea[]> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped List Query ---
    const serviceAreas = await prisma.serviceArea.findMany({
        where: {
            workspaceId,
        },
        orderBy: {
            name: "asc",
        },
        include: {
            _count: {
                select: { technicianServiceAreas: true },
            },
        },
    });

    return serviceAreas;
}
