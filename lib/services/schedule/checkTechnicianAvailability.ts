import type { PrismaClient } from "@/generated/prisma/client";
import {
    ScheduleTechnicianNotFoundError,
    ScheduleTechnicianNotEligibleError,
    ScheduleTechnicianOnLeaveError,
    ScheduleOutsideWorkingHoursError,
} from "./scheduleErrors";
import {
    assertNoTechnicianConflicts,
    assertTechnicianActive,
} from "./conflictDetection";
import { evaluateIntervalAvailability } from "@/lib/services/technicianProfile/availabilityIntervalUtils";

export interface CheckTechnicianAvailabilityParams {
    workspaceId: string;
    technicianId: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    timezone: string;
    excludeAppointmentId?: string;
}

export interface TechnicianAvailabilityResult {
    technician: any;
    isCoveredByRecurring: boolean;
    matchingWindows: any[];
    blockingExceptions: any[];
}

/**
 * Composite Availability & Eligibility Engine (Phase 1.8.1 §7, §8.1, §12 Step 5)
 *
 * Deterministically evaluates all three availability pillars:
 *   1. Technician identity, workspace scoping, and active employment status.
 *   2. Phase 1.3 weekly working hours coverage and schedule exceptions (time off, PTO, sick leave).
 *   3. Half-open interval appointment overlap conflict detection against active bookings.
 *
 * Semantic Error Taxonomy:
 * - Inactive or suspended technicians throw ScheduleTechnicianNotEligibleError (422).
 * - Approved schedule exceptions (time off / leave / training) throw ScheduleTechnicianOnLeaveError (422).
 * - Appointments outside configured weekly working hours throw ScheduleOutsideWorkingHoursError (422).
 * - Active overlapping bookings throw ScheduleTechnicianConflictError (409).
 */
export async function checkTechnicianAvailability(
    prismaClient: PrismaClient | any,
    params: CheckTechnicianAvailabilityParams,
): Promise<TechnicianAvailabilityResult> {
    const {
        workspaceId,
        technicianId,
        scheduledStart,
        scheduledEnd,
        timezone,
        excludeAppointmentId,
    } = params;

    // --- Pillar 1: Tenant-Scoped Technician Resolution & Employment Check ---
    const technician = await assertTechnicianActive(
        prismaClient,
        workspaceId,
        technicianId,
    );

    // --- Pillar 2: Working Hours & Schedule Exceptions Check (Phase 1.3 Engine) ---
    const activeAvailabilities = (technician.technicianAvailabilities || []).filter(
        (a: any) => a.status === "ACTIVE",
    );
    const activeExceptions = (technician.technicianAvailabilityExceptions || []).filter(
        (e: any) => e.status === "ACTIVE",
    );

    const intervalEval = evaluateIntervalAvailability(
        scheduledStart,
        scheduledEnd,
        timezone,
        activeAvailabilities,
        activeExceptions,
    );

    // Hard block on active approved time-off / leave exceptions
    if (intervalEval.blockingExceptions.length > 0) {
        throw new ScheduleTechnicianOnLeaveError(
            "Technician has an approved schedule exception (time off, sick leave, or training) during the requested time window.",
            intervalEval.blockingExceptions,
        );
    }

    // Hard block if weekly working hours are configured and the requested slot is outside them
    if (activeAvailabilities.length > 0 && !intervalEval.isCoveredByRecurring) {
        throw new ScheduleOutsideWorkingHoursError(
            "Technician is scheduled outside configured weekly working hours.",
        );
    }

    // --- Pillar 3: Half-Open Interval Appointment Overlap Conflicts (§7.2, §7.4) ---
    await assertNoTechnicianConflicts(prismaClient, {
        workspaceId,
        technicianId,
        scheduledStart,
        scheduledEnd,
        excludeAppointmentId,
    });

    return {
        technician,
        isCoveredByRecurring: intervalEval.isCoveredByRecurring,
        matchingWindows: intervalEval.matchingAvailability,
        blockingExceptions: intervalEval.blockingExceptions,
    };
}
