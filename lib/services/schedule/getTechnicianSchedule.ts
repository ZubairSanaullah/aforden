import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { ScheduleTechnicianNotFoundError } from "./scheduleErrors";
import {
    getTechnicianScheduleQuerySchema,
} from "./schedule.schemas";
import {
    toScheduleAppointmentReadModel,
    SCHEDULE_APPOINTMENT_INCLUDE,
} from "./scheduleReadModel";
import type { ScheduleAppointmentReadModel } from "./schedule.types";

/**
 * Retrieves all appointments for a technician across a given date range for calendar views.
 *
 * Locked Architectural Policy:
 * - Half-Open Interval: Uses `scheduledStart < rangeEnd AND scheduledEnd > rangeStart`
 *   to ensure appointments spanning into the window from before are captured.
 * - Cancelled Visibility: Excludes CANCELLED appointments by default (`status: { not: "CANCELLED" }`).
 *   Can be included via explicit `includeCancelled: true` flag.
 * - Scoping: Enforces technician exists in workspace, preventing arbitrary Prisma filter injection.
 */
export async function getTechnicianSchedule(
    workspaceId: string,
    technicianId: string,
    rawQuery: unknown,
): Promise<ScheduleAppointmentReadModel[]> {
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SCHEDULER_VIEW,
    );

    const query = getTechnicianScheduleQuerySchema.parse(rawQuery);

    // Assert technician exists in workspace
    const technician = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianId,
            employee: {
                workspaceId,
            },
        },
        select: { id: true },
    });

    if (!technician) {
        throw new ScheduleTechnicianNotFoundError();
    }

    const whereClause: Record<string, any> = {
        workspaceId,
        technicianId,
        scheduledStart: { lt: query.endDate },
        scheduledEnd: { gt: query.startDate },
    };

    if (!query.includeCancelled) {
        whereClause.status = { not: "CANCELLED" };
    }

    const appointments = await prisma.scheduleAppointment.findMany({
        where: whereClause,
        include: SCHEDULE_APPOINTMENT_INCLUDE,
        orderBy: {
            scheduledStart: "asc",
        },
    });

    return appointments.map(toScheduleAppointmentReadModel);
}
