import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
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
 * - Section 2.1 (Invariant 1: Single Authority Status Machine): Delegates lifecycle transition directly
 *   to Phase 1.6 `transitionWorkOrderStatus(workspaceId, workOrderId, { toStatus: "IN_PROGRESS" }, tx)`.
 *   This enforces role authorization, matrix legality, sets `startedAt`, and writes `WorkOrderHistory`.
 * - Section 4.1.2 & Section 6.1 (Touchpoint 2): Stamping `ScheduleAppointment.fieldExecutionStartedAt = now()`
 *   locks the appointment against subsequent Phase 1.8 `undispatchAppointment` recalls (travel-skipped case).
 * - Section 4.1.4 (Automatic Travel Closure) & Section 7.3: Automatically closes any open `ACTIVE` time entry
 *   for this technician (`endedAt = now()`, computing `durationMinutes`) before opening a new `ON_SITE` entry.
 * - Section 14: All mutations execute in a single, unified atomic `prisma.$transaction`.
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

    // 3. Persistence of WorkOrder State Transition, Execution Lock & Time Entries in Atomic Transaction (§14)
    const now = new Date();
    return await prisma.$transaction(async (tx) => {
        // 3a. Delegate lifecycle transition to canonical Phase 1.6 status machine (Invariant 1)
        const updatedWorkOrder = await transitionWorkOrderStatus(
            context.workspaceId,
            trimmedWorkOrderId,
            { toStatus: "IN_PROGRESS" },
            tx
        );

        // 3b. Resolve linked appointment for execution lock stamping (§4.1.2)
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

        // 3c. Automatic Travel/Active Entry Closure (§4.1.4, §7.3)
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

        // 3d. Open new ACTIVE ON_SITE time entry
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
}
