import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateTechnicianAvailabilityExceptionStatusSchema } from "@/lib/validations/technicianAvailabilityException";
import { TechnicianAvailabilityExceptionNotFoundError } from "./technicianAvailabilityExceptionErrors";
import type { TechnicianAvailabilityException } from "@/generated/prisma/client";

/**
 * Updates a TechnicianAvailabilityException record status (ACTIVE / CANCELLED).
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateTechnicianAvailabilityExceptionStatusSchema`).
 *   - Lookup is strictly tenant-scoped (`where: { id: exceptionId, technicianProfile: { employee: { workspaceId } } }`).
 *   - Setting to CANCELLED retains the record historically without altering recurring schedule.
 *   - Setting to ACTIVE makes the record an active blocking exception again.
 */
export async function updateTechnicianAvailabilityExceptionStatus(
    workspaceId: string,
    exceptionId: string,
    input: unknown,
): Promise<TechnicianAvailabilityException> {
    // --- Validate Input ---
    const data = updateTechnicianAvailabilityExceptionStatusSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
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

    // --- Execute Status Update ---
    const updated = await prisma.technicianAvailabilityException.update({
        where: {
            id: exceptionId,
        },
        data: {
            status: data.status,
        },
    });

    return updated;
}
