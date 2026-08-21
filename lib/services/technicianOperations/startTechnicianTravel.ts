import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleInvalidStatusTransitionError,
} from "@/lib/services/schedule/scheduleErrors";
import {
    TechnicianNotAssignedToWorkOrderError,
    ActiveTimeEntryExistsError,
} from "./technicianOperationsErrors";
import { recordScheduleHistory } from "@/lib/services/schedule/recordScheduleHistory";
import {
    startTravelSchema,
    toTechnicianTimeEntryReadModel,
    type TechnicianExecutionContext,
    type TechnicianTimeEntryReadModel,
} from "./technicianOperations.types";

/**
 * Initiates travel for an assigned WorkOrder by the authenticated technician.
 *
 * Operational & Invariant Rules:
 * - Section 2.2 (Invariant 2): Bound strictly to the caller's server-derived technician context (role: TECHNICIAN).
 * - Section 4: "1. DISPATCHED & ACKNOWLEDGED" is the strict precondition state before the travel phase begins.
 *   The linked ScheduleAppointment must be in `ACKNOWLEDGED` dispatch status.
 * - Section 4.1.1 (Invariant 1): WorkOrder status REMAINS `ASSIGNED` (on-site work has not commenced).
 * - Section 4.1.2 (Invariant 2) & Section 6.1 (Touchpoint 2): Stamping `ScheduleAppointment.fieldExecutionStartedAt = now()`
 *   is an unconditional invariant that permanently locks the appointment against Phase 1.8 `undispatchAppointment` recalls.
 *   A linked active ScheduleAppointment is strictly required; throws `ScheduleAppointmentNotFoundError` (404) if missing.
 * - Section 7.3 (Single-Active-Entry Rule): If the technician already has an active time entry, throws
 *   `ActiveTimeEntryExistsError` (409) rather than auto-closing (auto-close is reserved for on-site transition).
 * - Section 14: Executes directly in an unconditional atomic `prisma.$transaction`, recording audit history in `ScheduleAppointmentHistory`.
 */
export async function startTechnicianTravel(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown = {}
): Promise<TechnicianTimeEntryReadModel> {
    // 1. Role Enforcement (Invariant 2)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can start travel through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    // 2. Validate Input Payload
    const data = startTravelSchema.parse(input ?? {});

    // 3. Precondition: Resolve WorkOrder & Check Assignment + Status (§4.1, §5.1)
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: workOrderId.trim(),
            workspaceId: context.workspaceId,
        },
        select: {
            id: true,
            status: true,
            assignedTechnicianId: true,
        },
    });

    if (!workOrder) {
        throw new WorkOrderNotFoundError();
    }

    if (workOrder.assignedTechnicianId !== context.technicianProfileId) {
        throw new TechnicianNotAssignedToWorkOrderError(
            "You are not assigned to execute this work order."
        );
    }

    if (workOrder.status !== "ASSIGNED") {
        throw new WorkOrderInvalidStatusTransitionError(
            `Cannot start travel. Work order must be in ASSIGNED status (currently ${workOrder.status}).`
        );
    }

    // 4. Precondition: Single Active Time Entry Rule (§7.3)
    const existingActiveEntry = await prisma.technicianTimeEntry.findFirst({
        where: {
            workspaceId: context.workspaceId,
            technicianProfileId: context.technicianProfileId,
            status: "ACTIVE",
        },
        select: { id: true },
    });

    if (existingActiveEntry) {
        throw new ActiveTimeEntryExistsError(
            "An active time entry is already in progress for this technician."
        );
    }

    // 5. Precondition: Resolve Linked ScheduleAppointment & Verify Dispatch State (§4, §6.1)
    const appointment = await prisma.scheduleAppointment.findFirst({
        where: {
            workOrderId: workOrder.id,
            workspaceId: context.workspaceId,
            technicianId: context.technicianProfileId,
            status: { not: "CANCELLED" },
        },
        select: {
            id: true,
            dispatchStatus: true,
            fieldExecutionStartedAt: true,
        },
    });

    if (!appointment) {
        throw new ScheduleAppointmentNotFoundError(
            "No active scheduled appointment found for this work order and technician."
        );
    }

    if (appointment.dispatchStatus !== "ACKNOWLEDGED") {
        throw new ScheduleInvalidStatusTransitionError(
            `Appointment must be in ACKNOWLEDGED dispatch status before starting travel (currently ${appointment.dispatchStatus}).`,
            appointment.dispatchStatus,
            "ACKNOWLEDGED"
        );
    }

    // 6. Persistence in Unconditional Atomic Transaction (§14)
    const now = new Date();
    const createdEntry = await prisma.$transaction(async (tx) => {
        // Stamp fieldExecutionStartedAt on linked appointment if not yet set
        if (appointment.fieldExecutionStartedAt === null) {
            await tx.scheduleAppointment.update({
                where: { id: appointment.id },
                data: { fieldExecutionStartedAt: now },
            });

            await recordScheduleHistory(tx, {
                workspaceId: context.workspaceId,
                appointmentId: appointment.id,
                eventType: "UPDATED",
                actorMemberId: context.membershipId,
                actorName: context.technicianName,
                field: "fieldExecutionStartedAt",
                oldValue: null,
                newValue: now.toISOString(),
                metadata: {
                    notes: data.notes ?? null,
                },
            });
        }

        // Create ACTIVE TRAVEL time entry
        return tx.technicianTimeEntry.create({
            data: {
                workspaceId: context.workspaceId,
                technicianProfileId: context.technicianProfileId,
                workOrderId: workOrder.id,
                appointmentId: appointment.id,
                entryType: "TRAVEL",
                status: "ACTIVE",
                startedAt: now,
                endedAt: null,
                durationMinutes: null,
                notes: data.notes ?? null,
                metadata: data.metadata ? (data.metadata as any) : undefined,
                createdByMemberId: context.membershipId,
            },
        });
    });

    // 7. Return Canonical Read Model DTO
    return toTechnicianTimeEntryReadModel(createdEntry);
}
