import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { ScheduleWorkOrderNotFoundError } from "./scheduleErrors";
import {
    toScheduleAppointmentReadModel,
    SCHEDULE_APPOINTMENT_INCLUDE,
} from "./scheduleReadModel";
import type { ScheduleAppointmentReadModel } from "./schedule.types";

/**
 * Retrieves all appointments (including historical and cancelled) tied to a single WorkOrder.
 *
 * Ordered by scheduledStart ascending to present the complete historical schedule timeline.
 */
export async function getWorkOrderSchedule(
    workspaceId: string,
    workOrderId: string,
): Promise<ScheduleAppointmentReadModel[]> {
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SCHEDULER_VIEW,
    );

    // Assert WorkOrder exists in workspace
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: workOrderId,
            workspaceId,
        },
        select: { id: true },
    });

    if (!workOrder) {
        throw new ScheduleWorkOrderNotFoundError();
    }

    const appointments = await prisma.scheduleAppointment.findMany({
        where: {
            workspaceId,
            workOrderId,
        },
        include: SCHEDULE_APPOINTMENT_INCLUDE,
        orderBy: {
            scheduledStart: "asc",
        },
    });

    return appointments.map(toScheduleAppointmentReadModel);
}
