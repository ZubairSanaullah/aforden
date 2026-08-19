import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateServiceAreaStatusSchema } from "@/lib/validations/serviceArea";
import { ServiceAreaNotFoundError } from "./serviceAreaErrors";
import type { ServiceArea } from "@/generated/prisma/client";

/**
 * Updates a ServiceArea's lifecycle status within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Input is validated via Zod (`updateServiceAreaStatusSchema`).
 *   - ServiceArea lookup is strictly tenant-scoped (`where: { id: serviceAreaId, workspaceId }`).
 *   - Updates ONLY the `status` field, preserving name and description.
 *   - Does NOT modify assigned technicians, their EmployeeStatus, or MembershipStatus.
 */
export async function updateServiceAreaStatus(
    workspaceId: string,
    serviceAreaId: string,
    input: unknown,
): Promise<ServiceArea> {
    // --- Validate Input ---
    const data = updateServiceAreaStatusSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify ServiceArea Exists in Workspace ---
    const existing = await prisma.serviceArea.findFirst({
        where: {
            id: serviceAreaId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new ServiceAreaNotFoundError();
    }

    // --- Execute Status Update ---
    const updated = await prisma.serviceArea.update({
        where: {
            id: serviceAreaId,
        },
        data: {
            status: data.status,
        },
    });

    return updated;
}
