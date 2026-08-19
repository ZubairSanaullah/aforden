import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createTechnicianAvailabilityExceptionSchema } from "@/lib/validations/technicianAvailabilityException";
import {
    InvalidTechnicianProfileError,
    TechnicianAvailabilityExceptionAlreadyExistsError,
} from "./technicianAvailabilityExceptionErrors";
import type { TechnicianAvailabilityException } from "@/generated/prisma/client";

/**
 * Creates a schedule exception or time-off period for a TechnicianProfile.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`createTechnicianAvailabilityExceptionSchema`).
 *   - TechnicianProfile must exist and belong to the workspace (`employee.workspaceId === workspaceId`).
 *   - Time range must satisfy `startsAt < endsAt`.
 *   - Overlapping active exceptions are allowed and combined into cumulative unavailable periods.
 *   - Does NOT modify recurring TechnicianAvailability or Employee.status.
 */
export async function createTechnicianAvailabilityException(
    workspaceId: string,
    technicianProfileId: string,
    input: unknown,
): Promise<TechnicianAvailabilityException> {
    // --- Validate Input ---
    const data = createTechnicianAvailabilityExceptionSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
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

    // --- Check Exact Duplicate Exception ---
    const duplicate = await prisma.technicianAvailabilityException.findFirst({
        where: {
            technicianProfileId,
            type: data.type,
            title: data.title,
            startsAt: data.startsAt,
            endsAt: data.endsAt,
        },
    });

    if (duplicate) {
        throw new TechnicianAvailabilityExceptionAlreadyExistsError();
    }

    // --- Create Exception Record ---
    const exception = await prisma.technicianAvailabilityException.create({
        data: {
            technicianProfileId,
            type: data.type,
            status: data.status,
            title: data.title,
            startsAt: data.startsAt,
            endsAt: data.endsAt,
            isAllDay: data.isAllDay,
            notes: data.notes ?? null,
        },
    });

    return exception;
}
