import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { TechnicianAvailability, TechnicianProfile } from "@/generated/prisma/client";

export type TechnicianAvailabilityDetails = TechnicianAvailability & {
    technicianProfile: TechnicianProfile;
};

/**
 * Retrieves a single TechnicianAvailability record by ID within a specific workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookup is strictly scoped by `technicianProfile.employee.workspaceId`.
 *   - Returns `TechnicianAvailabilityDetails | null` if not found in workspace.
 */
export async function getTechnicianAvailability(
    workspaceId: string,
    availabilityId: string,
): Promise<TechnicianAvailabilityDetails | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const availability = await prisma.technicianAvailability.findFirst({
        where: {
            id: availabilityId,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
        include: {
            technicianProfile: true,
        },
    });

    return availability;
}
