import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { ServiceArea } from "@/generated/prisma/client";

/**
 * Retrieves a single ServiceArea by ID within a specific workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookup is strictly scoped by both `id` AND `workspaceId`.
 *   - Returns `ServiceArea | null` if not found in workspace.
 */
export async function getServiceArea(
    workspaceId: string,
    serviceAreaId: string,
): Promise<ServiceArea | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const serviceArea = await prisma.serviceArea.findFirst({
        where: {
            id: serviceAreaId,
            workspaceId,
        },
        include: {
            _count: {
                select: { technicianServiceAreas: true },
            },
        },
    });

    return serviceArea;
}
