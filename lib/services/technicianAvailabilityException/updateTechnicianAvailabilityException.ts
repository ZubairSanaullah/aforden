import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateTechnicianAvailabilityExceptionSchema } from "@/lib/validations/technicianAvailabilityException";
import {
    TechnicianAvailabilityExceptionNotFoundError,
    InvalidExceptionTimeError,
} from "./technicianAvailabilityExceptionErrors";
import type { TechnicianAvailabilityException } from "@/generated/prisma/client";

/**
 * Updates a TechnicianAvailabilityException record within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateTechnicianAvailabilityExceptionSchema`).
 *   - Lookup is strictly tenant-scoped (`where: { id: exceptionId, technicianProfile: { employee: { workspaceId } } }`).
 *   - Validates merged date bounds `effectiveStartsAt < effectiveEndsAt`.
 *   - Preserves omitted fields (undefined) and supports nullable clearing (null).
 *   - Does NOT modify recurring availability or Employee.status.
 */
export async function updateTechnicianAvailabilityException(
    workspaceId: string,
    exceptionId: string,
    input: unknown,
): Promise<TechnicianAvailabilityException> {
    // --- Validate Input ---
    const data = updateTechnicianAvailabilityExceptionSchema.parse(input);

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

    // --- Validate Effective Date Boundaries ---
    const effectiveStartsAt = data.startsAt ?? existing.startsAt;
    const effectiveEndsAt = data.endsAt ?? existing.endsAt;

    if (effectiveStartsAt.getTime() >= effectiveEndsAt.getTime()) {
        throw new InvalidExceptionTimeError(
            "Start date/time must be earlier than end date/time.",
        );
    }

    // --- Execute Update ---
    const updated = await prisma.technicianAvailabilityException.update({
        where: {
            id: exceptionId,
        },
        data,
    });

    return updated;
}
