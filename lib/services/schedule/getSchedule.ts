import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { ScheduleAppointmentNotFoundError } from "./scheduleErrors";
import {
    toScheduleAppointmentReadModel,
    SCHEDULE_APPOINTMENT_INCLUDE,
} from "./scheduleReadModel";
import type { ScheduleAppointmentReadModel } from "./schedule.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Retrieves a single ScheduleAppointment by ID in a tenant-isolated workspace.
 */
export async function getSchedule(
    workspaceId: string,
    appointmentId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<ScheduleAppointmentReadModel> {
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SCHEDULER_VIEW,
    );

    const appt = await prisma.scheduleAppointment.findFirst({
        where: {
            id: appointmentId,
            workspaceId,
        },
        include: SCHEDULE_APPOINTMENT_INCLUDE,
    });

    if (!appt) {
        throw new ScheduleAppointmentNotFoundError();
    }

    return toScheduleAppointmentReadModel(appt);
}
