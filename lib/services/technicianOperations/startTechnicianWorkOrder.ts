import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
} from "@/lib/services/workOrder/workOrderErrors";
import { TechnicianNotAssignedToWorkOrderError } from "./technicianOperationsErrors";
import { toWorkOrderReadModel } from "@/lib/services/workOrder/getWorkOrder";
import { recordScheduleHistory } from "@/lib/services/schedule/recordScheduleHistory";
import {
    startWorkOrderSchema,
    type TechnicianExecutionContext,
} from "./technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

/**
 * Commences on-site execution for an assigned WorkOrder by the authenticated technician.
 *
 * Operational & Invariant Rules:
 * - Section 2.1 (Invariant 1: Single Authority Status Machine): Transitions WorkOrder from `ASSIGNED` to
 *   `IN_PROGRESS`, sets `workOrder.startedAt = now()`, and writes `WorkOrderHistory` (`STATUS_CHANGED`).
 * - Section 4.1.2 & Section 6.1 (Touchpoint 2): Stamping `ScheduleAppointment.fieldExecutionStartedAt = now()`
 *   locks the appointment against subsequent Phase 1.8 `undispatchAppointment` recalls (travel-skipped case).
 * - Section 4.1.4 (Automatic Travel Closure) & Section 7.3: Automatically closes any open `ACTIVE` time entry
 *   for this technician (`endedAt = now()`, computing `durationMinutes`) before opening a new `ON_SITE` entry.
 * - Section 14: All mutations execute in an atomic `prisma.$transaction`.
 */
export async function startTechnicianWorkOrder(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown = {}
): Promise<WorkOrderReadModel> {
    // 1. Role Enforcement (Invariant 2)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can start work orders through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();

    // 2. Validate Input Payload
    const data = startWorkOrderSchema.parse(input ?? {});

    // 3. Resolve WorkOrder & Check Preconditions (§4.1, §5.1)
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: trimmedWorkOrderId,
            workspaceId: context.workspaceId,
        },
        include: {
            customer: true,
            location: true,
            workType: true,
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
            `Cannot start work order. Work order must be in ASSIGNED status (currently ${workOrder.status}).`
        );
    }

    // 4. Persistence of WorkOrder State Transition, Execution Lock & Time Entries in Atomic Transaction (§14)
    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
        // 4a. Transition WorkOrder status to IN_PROGRESS
        const updatedWorkOrder = await tx.workOrder.update({
            where: { id: workOrder.id },
            data: {
                status: "IN_PROGRESS",
                startedAt: workOrder.startedAt ?? now,
            },
            include: {
                customer: true,
                location: true,
                workType: true,
            },
        });

        // 4b. Record WorkOrderHistory audit trail (§9.1)
        if (tx.workOrderHistory?.create) {
            await tx.workOrderHistory.create({
                data: {
                    workspaceId: context.workspaceId,
                    workOrderId: workOrder.id,
                    eventType: "STATUS_CHANGED",
                    actorMemberId: context.membershipId,
                    actorName: context.technicianName,
                    field: "status",
                    oldValue: "ASSIGNED",
                    newValue: "IN_PROGRESS",
                    metadata: data.notes ? JSON.stringify({ notes: data.notes }) : null,
                },
            });
        }

        // 4c. Resolve linked appointment for execution lock stamping (§4.1.2)
        const appointment = await tx.scheduleAppointment.findFirst({
            where: {
                workOrderId: trimmedWorkOrderId,
                workspaceId: context.workspaceId,
                technicianId: context.technicianProfileId,
                status: { not: "CANCELLED" },
            },
            select: {
                id: true,
                fieldExecutionStartedAt: true,
            },
        });

        if (appointment && appointment.fieldExecutionStartedAt === null) {
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

        // 4d. Automatic Travel/Active Entry Closure (§4.1.4, §7.3)
        const activeEntry = await tx.technicianTimeEntry.findFirst({
            where: {
                workspaceId: context.workspaceId,
                technicianProfileId: context.technicianProfileId,
                status: "ACTIVE",
            },
        });

        if (activeEntry) {
            const durationMinutes = Math.max(
                0,
                Math.round((now.getTime() - activeEntry.startedAt.getTime()) / 60000)
            );

            await tx.technicianTimeEntry.update({
                where: { id: activeEntry.id },
                data: {
                    endedAt: now,
                    durationMinutes,
                    status: "COMPLETED",
                },
            });
        }

        // 4e. Open new ACTIVE ON_SITE time entry
        await tx.technicianTimeEntry.create({
            data: {
                workspaceId: context.workspaceId,
                technicianProfileId: context.technicianProfileId,
                workOrderId: trimmedWorkOrderId,
                appointmentId: appointment?.id ?? null,
                entryType: "ON_SITE",
                status: "ACTIVE",
                startedAt: now,
                endedAt: null,
                durationMinutes: null,
                notes: data.notes ?? null,
                metadata: data.metadata ? (data.metadata as any) : undefined,
                createdByMemberId: context.membershipId,
            },
        });

        return updatedWorkOrder;
    });

    return toWorkOrderReadModel(updated);
}
