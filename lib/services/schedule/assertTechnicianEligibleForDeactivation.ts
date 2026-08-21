import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ScheduleTechnicianActiveBookingsError } from "./scheduleErrors";

export interface TechnicianDeactivationEligibilityResult {
    eligible: boolean;
    activeCount: number;
    appointmentIds: string[];
}

/**
 * Asserts that a technician has no future active appointments before being deactivated.
 *
 * Architectural Governance (Phase 1.8.9 Task 2):
 * - Phase 1.3 / Employee Management owns Employee.status mutations.
 * - This function is the official Scheduling Domain contract that Phase 1.3
 *   or administrative handlers can invoke to guarantee that deactivating a technician
 *   does not leave orphaned, active future bookings.
 * - Queries future appointments with status IN ['SCHEDULED', 'RESCHEDULED'] and scheduledEnd > now.
 * - Throws ScheduleTechnicianActiveBookingsError (409) if any active future bookings exist.
 */
export async function assertTechnicianEligibleForDeactivation(
    prismaClient: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    technicianId: string,
    referenceDate: Date = new Date(),
): Promise<TechnicianDeactivationEligibilityResult> {
    const activeFutureAppointments = await prismaClient.scheduleAppointment.findMany({
        where: {
            workspaceId,
            technicianId,
            status: { in: ["SCHEDULED", "RESCHEDULED"] },
            scheduledEnd: { gt: referenceDate },
        },
        select: {
            id: true,
            appointmentNumber: true,
            scheduledStart: true,
            scheduledEnd: true,
        },
    });

    if (activeFutureAppointments.length > 0) {
        const appointmentIds = activeFutureAppointments.map((a: any) => a.id);
        throw new ScheduleTechnicianActiveBookingsError(
            activeFutureAppointments.length,
            appointmentIds,
            `Technician cannot be deactivated because they have ${activeFutureAppointments.length} active future appointment(s). Reassign or cancel these appointments first.`,
        );
    }

    return {
        eligible: true,
        activeCount: 0,
        appointmentIds: [],
    };
}
