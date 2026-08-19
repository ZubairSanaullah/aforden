import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type {
    TechnicianAvailabilityException,
    TechnicianProfile,
} from "@/generated/prisma/client";

export type TechnicianAvailabilityExceptionDetails =
    TechnicianAvailabilityException & {
        technicianProfile: TechnicianProfile;
    };

/**
 * Retrieves a single TechnicianAvailabilityException record by ID within a specific workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookup is strictly scoped by `technicianProfile.employee.workspaceId`.
 *   - Returns `TechnicianAvailabilityExceptionDetails | null` if not found in workspace.
 */
export async function getTechnicianAvailabilityException(
    workspaceId: string,
    exceptionId: string,
): Promise<TechnicianAvailabilityExceptionDetails | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const exception = await prisma.technicianAvailabilityException.findFirst({
        where: {
            id: exceptionId,
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

    return exception;
}
