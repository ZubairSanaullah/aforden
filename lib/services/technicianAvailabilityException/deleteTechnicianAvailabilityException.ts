import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { TechnicianAvailabilityExceptionNotFoundError } from "./technicianAvailabilityExceptionErrors";
import type { TechnicianAvailabilityException } from "@/generated/prisma/client";

/**
 * Deletes a TechnicianAvailabilityException record within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_REMOVE permission (OWNER or ADMIN).
 *   - Lookup is strictly tenant-scoped (`where: { id: exceptionId, technicianProfile: { employee: { workspaceId } } }`).
 *   - Deleting an exception NEVER deletes TechnicianProfile, Employee, or User records.
 */
export async function deleteTechnicianAvailabilityException(
    workspaceId: string,
    exceptionId: string,
): Promise<TechnicianAvailabilityException> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_REMOVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_REMOVE,
    );

    // --- Verify Exception Exists in Workspace ---
    const existing = await prisma.technicianAvailabilityException.findFirst({
        where: {
            id: exceptionId,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
    });

    if (!existing) {
        throw new TechnicianAvailabilityExceptionNotFoundError();
    }

    // --- Execute Deletion ---
    const deleted = await prisma.technicianAvailabilityException.delete({
        where: {
            id: exceptionId,
        },
    });

    return deleted;
}
