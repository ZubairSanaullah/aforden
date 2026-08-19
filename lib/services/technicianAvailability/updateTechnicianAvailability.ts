import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    updateTechnicianAvailabilitySchema,
    parseTimeToMinutes,
    isTimeEarlier,
} from "@/lib/validations/technicianAvailability";
import {
    TechnicianAvailabilityNotFoundError,
    TechnicianAvailabilityAlreadyExistsError,
    InvalidAvailabilityTimeError,
    AvailabilityOverlapError,
} from "./technicianAvailabilityErrors";
import type { TechnicianAvailability } from "@/generated/prisma/client";

/**
 * Updates a TechnicianAvailability record within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateTechnicianAvailabilitySchema`).
 *   - Lookup is strictly tenant-scoped (`where: { id: availabilityId, technicianProfile: { employee: { workspaceId } } }`).
 *   - Validates merged time bounds `startTime < endTime`.
 *   - Re-evaluates active schedule overlap if day, time, or status changes.
 *   - Preserves omitted fields (undefined) and supports nullable clearing (null).
 */
export async function updateTechnicianAvailability(
    workspaceId: string,
    availabilityId: string,
    input: unknown,
): Promise<TechnicianAvailability> {
    // --- Validate Input ---
    const data = updateTechnicianAvailabilitySchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify TechnicianAvailability Exists in Workspace ---
    const existing = await prisma.technicianAvailability.findFirst({
        where: {
            id: availabilityId,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
    });

    if (!existing) {
        throw new TechnicianAvailabilityNotFoundError();
    }

    // --- Compute Effective Values ---
    const effectiveDay = data.dayOfWeek ?? existing.dayOfWeek;
    const effectiveStart = data.startTime ?? existing.startTime;
    const effectiveEnd = data.endTime ?? existing.endTime;
    const effectiveStatus = data.status ?? existing.status;

    // --- Verify Effective Time Order ---
    if (!isTimeEarlier(effectiveStart, effectiveEnd)) {
        throw new InvalidAvailabilityTimeError(
            "Start time must be earlier than end time.",
        );
    }

    // --- Check Duplicate Window if Time/Day changed ---
    if (
        effectiveDay !== existing.dayOfWeek ||
        effectiveStart !== existing.startTime ||
        effectiveEnd !== existing.endTime
    ) {
        const duplicate = await prisma.technicianAvailability.findUnique({
            where: {
                technicianProfileId_dayOfWeek_startTime_endTime: {
                    technicianProfileId: existing.technicianProfileId,
                    dayOfWeek: effectiveDay,
                    startTime: effectiveStart,
                    endTime: effectiveEnd,
                },
            },
        });

        if (duplicate && duplicate.id !== availabilityId) {
            throw new TechnicianAvailabilityAlreadyExistsError();
        }
    }

    // --- Active Overlap Check ---
    if (effectiveStatus === "ACTIVE") {
        const activeRecords = await prisma.technicianAvailability.findMany({
            where: {
                technicianProfileId: existing.technicianProfileId,
                dayOfWeek: effectiveDay,
                status: "ACTIVE",
                id: { not: availabilityId },
            },
        });

        const targetStart = parseTimeToMinutes(effectiveStart);
        const targetEnd = parseTimeToMinutes(effectiveEnd);

        for (const rec of activeRecords) {
            const recStart = parseTimeToMinutes(rec.startTime);
            const recEnd = parseTimeToMinutes(rec.endTime);

            if (targetStart < recEnd && recStart < targetEnd) {
                throw new AvailabilityOverlapError(
                    `Availability window ${effectiveStart}-${effectiveEnd} on ${effectiveDay} overlaps with existing active window ${rec.startTime}-${rec.endTime}.`,
                );
            }
        }
    }

    // --- Execute Update ---
    const updated = await prisma.technicianAvailability.update({
        where: {
            id: availabilityId,
        },
        data,
    });

    return updated;
}
