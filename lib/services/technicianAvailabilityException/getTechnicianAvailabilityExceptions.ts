import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { InvalidTechnicianProfileError } from "./technicianAvailabilityExceptionErrors";
import type { TechnicianAvailabilityException } from "@/generated/prisma/client";

/**
 * Retrieves all schedule exceptions and time-off records for a TechnicianProfile within a workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Verifies TechnicianProfile belongs to the target workspace (`InvalidTechnicianProfileError`).
 *   - Deterministically orders results by `startsAt ASC`, then `endsAt ASC`.
 *   - Returns both ACTIVE and CANCELLED records for complete audit/historical tracking.
 */
export async function getTechnicianAvailabilityExceptions(
    workspaceId: string,
    technicianProfileId: string,
): Promise<TechnicianAvailabilityException[]> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Verify TechnicianProfile Exists in Workspace ---
    const profile = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
    });

    if (!profile) {
        throw new InvalidTechnicianProfileError();
    }

    // --- Retrieve Records Ordered by startsAt ASC, endsAt ASC ---
    const exceptions = await prisma.technicianAvailabilityException.findMany({
        where: {
            technicianProfileId,
        },
        orderBy: [
            {
                startsAt: "asc",
            },
            {
                endsAt: "asc",
            },
        ],
    });

    return exceptions;
}
