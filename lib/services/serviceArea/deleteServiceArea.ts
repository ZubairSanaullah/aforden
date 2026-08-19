import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    ServiceAreaNotFoundError,
    ServiceAreaHasAssignedTechniciansError,
} from "./serviceAreaErrors";
import type { ServiceArea } from "@/generated/prisma/client";

/**
 * Deletes a ServiceArea from a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_REMOVE permission (OWNER or ADMIN).
 *   - ServiceArea lookup is strictly tenant-scoped (`where: { id: serviceAreaId, workspaceId }`).
 *   - Prevents deletion if technicians are currently assigned to the service area (`ServiceAreaHasAssignedTechniciansError`).
 *   - Deleting a service area NEVER deletes TechnicianProfile, Employee, or User records.
 */
export async function deleteServiceArea(
    workspaceId: string,
    serviceAreaId: string,
): Promise<ServiceArea> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_REMOVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_REMOVE,
    );

    // --- Verify ServiceArea Exists in Workspace ---
    const existing = await prisma.serviceArea.findFirst({
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

    if (!existing) {
        throw new ServiceAreaNotFoundError();
    }

    // --- Enforce: Reject deletion if technicians are assigned ---
    if (existing._count.technicianServiceAreas > 0) {
        throw new ServiceAreaHasAssignedTechniciansError(
            "Cannot delete service area while technicians are assigned to it.",
        );
    }

    // --- Execute Deletion ---
    const deleted = await prisma.serviceArea.delete({
        where: {
            id: serviceAreaId,
        },
    });

    return deleted;
}
