import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { ScheduleAppointmentNotFoundError } from "@/lib/services/schedule/scheduleErrors";
import { acknowledgeDispatch } from "@/lib/services/schedule/acknowledgeDispatch";
import { TechnicianNotAssignedToWorkOrderError } from "./technicianOperationsErrors";
import type { TechnicianExecutionContext } from "./technicianOperations.types";
import type { ScheduleAppointmentReadModel } from "@/lib/services/schedule/schedule.types";

/**
 * Acknowledges dispatch receipt for a scheduled appointment from the technician execution workflow.
 *
 * Architecture & Invariant Rules:
 * - Section 2.2 (Invariant 2): Technician operations services are strictly bound to authenticated technician
 *   identities resolved via `resolveTechnicianContext()`. Only users with the `TECHNICIAN` role holding an active
 *   technician profile may invoke this service. Administrative overrides (OWNER, ADMIN, MANAGER, DISPATCHER)
 *   belong on Phase 1.8's administrative path (`acknowledgeDispatch()`).
 * - Section 6.1 (Touchpoint 1): Acknowledging dispatch transitions `dispatchStatus: DISPATCHED -> ACKNOWLEDGED`.
 * - Section 5.1: WorkOrder status REMAINS `ASSIGNED` (does not mutate WorkOrderStatus).
 * - Section 9 & 14: Delegates directly to Phase 1.8 `acknowledgeDispatch()` service to execute the state
 *   transition and write canonical `ScheduleAppointmentHistory` (`UPDATED`, `field: dispatchStatus`) atomically.
 *   The actor identity (`actorMemberId`) is strictly derived from the caller's server session within the
 *   delegated service (`requireWorkspaceAuthorization`), guaranteeing 100% server-side audit integrity.
 * - Invariant 3: Unconditionally enforces that the caller is the assigned technician on the appointment
 *   (`appointment.technicianId === context.technicianProfileId`). If mismatched, throws
 *   `TechnicianNotAssignedToWorkOrderError` (403 Forbidden).
 */
export async function acknowledgeTechnicianDispatch(
    context: TechnicianExecutionContext,
    workOrderId: string,
    appointmentId: string,
    input: unknown = {}
): Promise<ScheduleAppointmentReadModel> {
    // 1. Role Enforcement (Invariant 2 & Section 11)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can acknowledge dispatch through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new ScheduleAppointmentNotFoundError();
    }

    if (!appointmentId || typeof appointmentId !== "string" || !appointmentId.trim()) {
        throw new ScheduleAppointmentNotFoundError();
    }

    // 2. Resolve target appointment within tenant and verify workOrder linkage
    const appointment = await prisma.scheduleAppointment.findFirst({
        where: {
            id: appointmentId.trim(),
            workOrderId: workOrderId.trim(),
            workspaceId: context.workspaceId,
        },
        select: {
            id: true,
            technicianId: true,
            dispatchStatus: true,
        },
    });

    if (!appointment) {
        throw new ScheduleAppointmentNotFoundError();
    }

    // 3. Unconditional Technician Assignment Guard (§6.1 touchpoint 1, Invariant 3)
    if (appointment.technicianId !== context.technicianProfileId) {
        throw new TechnicianNotAssignedToWorkOrderError(
            "You are not authorized to acknowledge dispatch for appointments assigned to another technician."
        );
    }

    // 4. Delegate to Phase 1.8 canonical acknowledgeDispatch service (§6.1, §14)
    return acknowledgeDispatch(context.workspaceId, appointment.id, input);
}
