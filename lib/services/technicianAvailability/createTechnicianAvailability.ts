import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    createTechnicianAvailabilitySchema,
    parseTimeToMinutes,
} from "@/lib/validations/technicianAvailability";
import {
    TechnicianAvailabilityAlreadyExistsError,
    InvalidTechnicianProfileError,
    AvailabilityOverlapError,
} from "./technicianAvailabilityErrors";
import type { TechnicianAvailability } from "@/generated/prisma/client";

/**
 * Creates a recurring weekly availability record for a TechnicianProfile.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`createTechnicianAvailabilitySchema`).
 *   - TechnicianProfile must exist and belong to the workspace (`employee.workspaceId === workspaceId`).
 *   - Time range must satisfy `startTime < endTime` in local 24-hour format.
 *   - If status is ACTIVE, verifies no overlapping active windows exist on the same day for this technician.
 *   - Touching intervals (e.g. 08:00-12:00 and 12:00-17:00) are valid and allowed.
 *   - Inactive records do not block new active schedules.
 */
export async function createTechnicianAvailability(
    workspaceId: string,
    technicianProfileId: string,
    input: unknown,
): Promise<TechnicianAvailability> {
    // --- Validate Input ---
    const data = createTechnicianAvailabilitySchema.parse(input);

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

    // --- Check Duplicate Availability Window ---
    const duplicate = await prisma.technicianAvailability.findUnique({
        where: {
            technicianProfileId_dayOfWeek_startTime_endTime: {
                technicianProfileId,
                dayOfWeek: data.dayOfWeek,
                startTime: data.startTime,
                endTime: data.endTime,
            },
        },
    });

    if (duplicate) {
        throw new TechnicianAvailabilityAlreadyExistsError();
    }

    // --- Active Overlap Check ---
    if (data.status === "ACTIVE") {
        const activeRecords = await prisma.technicianAvailability.findMany({
            where: {
                technicianProfileId,
                dayOfWeek: data.dayOfWeek,
                status: "ACTIVE",
            },
        });

        const targetStart = parseTimeToMinutes(data.startTime);
        const targetEnd = parseTimeToMinutes(data.endTime);

        for (const rec of activeRecords) {
            const recStart = parseTimeToMinutes(rec.startTime);
            const recEnd = parseTimeToMinutes(rec.endTime);

            // Half-open interval overlap check: [targetStart, targetEnd) overlaps [recStart, recEnd)
            if (targetStart < recEnd && recStart < targetEnd) {
                throw new AvailabilityOverlapError(
                    `Availability window ${data.startTime}-${data.endTime} on ${data.dayOfWeek} overlaps with existing active window ${rec.startTime}-${rec.endTime}.`,
                );
            }
        }
    }

    // --- Create Availability Record ---
    const availability = await prisma.technicianAvailability.create({
        data: {
            technicianProfileId,
            dayOfWeek: data.dayOfWeek,
            startTime: data.startTime,
            endTime: data.endTime,
            status: data.status,
            notes: data.notes ?? null,
        },
    });

    return availability;
}
