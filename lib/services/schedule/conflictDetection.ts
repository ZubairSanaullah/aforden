import type { PrismaClient } from "@/generated/prisma/client";
import {
    ScheduleTechnicianNotFoundError,
    ScheduleTechnicianNotEligibleError,
    ScheduleTechnicianConflictError,
} from "./scheduleErrors";
import type { ScheduleConflictItem } from "./schedule.types";

/**
 * Asserts that a technician exists in the specified workspace and has an ACTIVE employment status.
 * (Phase 1.8.1 §12 Step 4 & §9.2 Step 4)
 */
export async function assertTechnicianActive(
    prismaClient: PrismaClient | any,
    workspaceId: string,
    technicianId: string,
): Promise<any> {
    const technician = await prismaClient.technicianProfile.findFirst({
        where: {
            id: technicianId,
            employee: {
                workspaceId,
            },
        },
        include: {
            employee: true,
            technicianAvailabilities: true,
            technicianAvailabilityExceptions: true,
        },
    });

    if (!technician) {
        throw new ScheduleTechnicianNotFoundError();
    }

    if (technician.employee.status !== "ACTIVE") {
        throw new ScheduleTechnicianNotEligibleError(
            "Technician is inactive, suspended, or not eligible for appointment scheduling or dispatch.",
            [technician.employee.status],
        );
    }

    return technician;
}

export interface CheckTechnicianConflictsParams {
    workspaceId: string;
    technicianId: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    excludeAppointmentId?: string;
}

/**
 * Finds and asserts technician schedule interval conflicts using the canonical
 * half-open interval overlap formula (Phase 1.8.1 §7.2):
 *
 *   existing.scheduledStart < requested.scheduledEnd
 *   AND requested.scheduledStart < existing.scheduledEnd
 *
 * Query Scope:
 * - Active appointments only (status IN ['SCHEDULED', 'RESCHEDULED'])
 * - Same workspaceId and technicianId
 * - Excludes the specified appointmentId (when rescheduling/modifying an existing booking)
 */
export async function assertNoTechnicianConflicts(
    prismaClient: PrismaClient | any,
    params: CheckTechnicianConflictsParams,
): Promise<void> {
    const {
        workspaceId,
        technicianId,
        scheduledStart,
        scheduledEnd,
        excludeAppointmentId,
    } = params;

    const whereClause: Record<string, any> = {
        workspaceId,
        technicianId,
        status: { in: ["SCHEDULED", "RESCHEDULED"] },
        scheduledStart: {
            lt: scheduledEnd,
        },
        scheduledEnd: {
            gt: scheduledStart,
        },
    };

    if (excludeAppointmentId) {
        whereClause.id = { not: excludeAppointmentId };
    }

    const existingConflicts: ScheduleConflictItem[] = await prismaClient.scheduleAppointment.findMany({
        where: whereClause,
        select: {
            id: true,
            appointmentNumber: true,
            technicianId: true,
            workOrderId: true,
            scheduledStart: true,
            scheduledEnd: true,
            status: true,
        },
    });

    if (existingConflicts.length > 0) {
        throw new ScheduleTechnicianConflictError(
            "Technician already has an active overlapping appointment during the requested time window.",
            existingConflicts,
        );
    }
}
