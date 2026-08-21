import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderCompletionPreconditionFailedError,
} from "@/lib/services/workOrder/workOrderErrors";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import { recordScheduleHistory } from "@/lib/services/schedule/recordScheduleHistory";
import {
    completeWorkOrderSchema,
    type TechnicianExecutionContext,
    type CompleteWorkOrderInput,
} from "./technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

/**
 * Completes an in-progress WorkOrder by the assigned technician.
 *
 * Operational & Invariant Rules:
 * - Section 2.1 (Invariant 1: Single Authority Status Machine): Delegates lifecycle transition directly
 *   to Phase 1.6 `transitionWorkOrderStatus(workspaceId, workOrderId, { toStatus: "COMPLETED" }, tx)`.
 *   This enforces matrix legality, sets `completedAt`, and writes initial `WorkOrderHistory`.
 * - Section 5.2 (Completion Precondition Enforcement): Validates preconditions before calling transition:
 *   1. WorkOrder must currently be IN_PROGRESS.
 *   2. assignedTechnicianId must not be null.
 *   3. Caller must be the assigned technician (assignedTechnicianId === context.technicianProfileId).
 *   On failure, throws `WorkOrderCompletionPreconditionFailedError` (422).
 * - Section 6.1 (Touchpoint 3 - Appointment Completion):
 *   Marks any active `ScheduleAppointment` linked to this WorkOrder and technician as `status = "COMPLETED"`.
 *   Writes to `ScheduleAppointmentHistory` via `recordScheduleHistory(tx, { eventType: "COMPLETED" })`.
 * - Section 7.3: Automatically closes any open `ACTIVE` time entry for this technician/workOrder
 *   (`endedAt = now()`, computing `durationMinutes`, `status = "COMPLETED"`).
 * - Section 8.1 & Section 9.1: Serializes `resolutionNotes` and `completedByTechId` into `WorkOrderHistory.metadata`.
 *   Targets strictly the single created `WorkOrderHistory` record by its unique primary ID (`_historyRecordId`).
 *   If the target history record cannot be resolved, hard-fails (throws) to prevent silent audit data loss.
 * - Section 14 (Step 7 - DTO Hygiene): Explicitly strips internal plumbing fields (`_historyRecordId`)
 *   before returning the pure public `WorkOrderReadModel`.
 */
export async function completeTechnicianWorkOrder(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown = {}
): Promise<WorkOrderReadModel> {
    // 1. Role Enforcement (Invariant 2)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can complete work orders through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();

    // 2. Validate Input Payload
    const data = completeWorkOrderSchema.parse(input ?? {});

    // 3. Precondition Verification (§5.2)
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: trimmedWorkOrderId,
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

    if (workOrder.status !== "IN_PROGRESS") {
        throw new WorkOrderCompletionPreconditionFailedError(
            "Cannot complete work order: work order must be in IN_PROGRESS status."
        );
    }

    if (!workOrder.assignedTechnicianId) {
        throw new WorkOrderCompletionPreconditionFailedError(
            "Cannot complete work order: an assigned technician is required."
        );
    }

    if (workOrder.assignedTechnicianId !== context.technicianProfileId) {
        throw new WorkOrderCompletionPreconditionFailedError(
            "Cannot complete work order: you are not the assigned technician."
        );
    }

    // 4. Persistence of WorkOrder State Transition, Appointment Completion, Time Entry Closure & History in Atomic Transaction (§14)
    const now = new Date();
    return await prisma.$transaction(async (tx) => {
        // 4a. Delegate lifecycle transition to canonical Phase 1.6 status machine (Invariant 1)
        const updatedWorkOrder = await transitionWorkOrderStatus(
            context.workspaceId,
            trimmedWorkOrderId,
            { toStatus: "COMPLETED" },
            tx
        );

        // 4b. Appointment Completion Touchpoint (§6.1 Touchpoint 3)
        const appointments = await tx.scheduleAppointment.findMany({
            where: {
                workOrderId: trimmedWorkOrderId,
                workspaceId: context.workspaceId,
                technicianId: context.technicianProfileId,
                status: { in: ["SCHEDULED", "RESCHEDULED"] },
            },
            select: {
                id: true,
                status: true,
            },
        });

        for (const appt of appointments) {
            await tx.scheduleAppointment.update({
                where: { id: appt.id },
                data: { status: "COMPLETED" },
            });

            await recordScheduleHistory(tx, {
                workspaceId: context.workspaceId,
                appointmentId: appt.id,
                eventType: "COMPLETED",
                actorMemberId: context.membershipId,
                actorName: context.technicianName,
                field: "status",
                oldValue: appt.status,
                newValue: "COMPLETED",
                metadata: {
                    resolutionNotes: data.resolutionNotes ?? null,
                },
            });
        }

        // 4c. Close remaining ACTIVE time entry (§7.3)
        const activeEntry = await tx.technicianTimeEntry.findFirst({
            where: {
                workspaceId: context.workspaceId,
                technicianProfileId: context.technicianProfileId,
                workOrderId: trimmedWorkOrderId,
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

        // 4d. Serialize resolution notes and completedByTechId into WorkOrderHistory.metadata (§8.1, §9.1)
        // Targeted ID update: update exactly the single WorkOrderHistory record created during this completion
        const historyRecordId = (updatedWorkOrder as any)._historyRecordId;
        if (!historyRecordId) {
            throw new Error(
                "Failed to identify target WorkOrderHistory record for resolution metadata persistence."
            );
        }

        await tx.workOrderHistory.update({
            where: {
                id: historyRecordId,
            },
            data: {
                metadata: JSON.stringify({
                    resolutionNotes: data.resolutionNotes ?? undefined,
                    completedByTechId: context.technicianProfileId,
                    mediaUris: data.mediaUris && data.mediaUris.length > 0 ? data.mediaUris : undefined,
                }),
            },
        });

        // 4e. DTO Hygiene (§14 Step 7): Explicitly omit internal audit plumbing property before returning
        const { _historyRecordId, ...cleanWorkOrder } = updatedWorkOrder as any;
        return cleanWorkOrder as WorkOrderReadModel;
    });
}
