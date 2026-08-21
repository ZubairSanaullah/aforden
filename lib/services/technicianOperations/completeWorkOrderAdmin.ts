import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderCompletionPreconditionFailedError,
} from "@/lib/services/workOrder/workOrderErrors";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import { recordScheduleHistory } from "@/lib/services/schedule/recordScheduleHistory";
import {
    completeWorkOrderSchema,
    type CompleteWorkOrderInput,
} from "./technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

/**
 * Administratively completes an in-progress WorkOrder.
 *
 * Operational & Invariant Rules:
 * - Section 2.2 (Invariant 2): Administrative operations authenticate via standard workspace authorization
 *   (`requireWorkspaceAuthorization`) and are not bound to `TechnicianExecutionContext`.
 * - Section 11.1 (RBAC): Strictly permits `OWNER`, `ADMIN`, and `MANAGER` roles.
 *   `DISPATCHER` is strictly rejected per §11.1 matrix with `ForbiddenError` (403).
 *   `TECHNICIAN` and `ACCOUNTANT` roles throw `ForbiddenError` (403).
 * - Section 5.2 (Completion Precondition Enforcement):
 *   1. WorkOrder must currently be IN_PROGRESS.
 *   2. assignedTechnicianId must not be null.
 *   On failure, throws `WorkOrderCompletionPreconditionFailedError` (422).
 * - Section 6.1 (Touchpoint 3 - Appointment Completion):
 *   Marks any active `ScheduleAppointment` linked to this WorkOrder as `status = "COMPLETED"`.
 *   Writes to `ScheduleAppointmentHistory` via `recordScheduleHistory(tx, { eventType: "COMPLETED" })`.
 * - Section 7.3: Automatically closes any open `ACTIVE` time entry for this workOrder
 *   (`endedAt = now()`, computing `durationMinutes`, `status = "COMPLETED"`).
 * - Section 8.1 & Section 9.1: Serializes `resolutionNotes` and `completedByTechId` into `WorkOrderHistory.metadata`.
 *   Targets strictly the single created `WorkOrderHistory` record by its unique primary ID (`_historyRecordId`).
 *   If the target history record cannot be resolved, hard-fails (throws) to prevent silent audit data loss.
 * - Section 14 (Step 7 - DTO Hygiene): Explicitly strips internal plumbing fields (`_historyRecordId`)
 *   before returning the pure public `WorkOrderReadModel`.
 */
export async function completeWorkOrderAdmin(
    workspaceId: string,
    workOrderId: string,
    input: unknown = {}
): Promise<WorkOrderReadModel> {
    if (!workspaceId || typeof workspaceId !== "string" || !workspaceId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    // 1. Authenticate session & verify active membership in workspace
    const authorization = await requireWorkspaceAuthorization(workspaceId.trim());

    // 2. Role Enforcement (RBAC Matrix §11.1: OWNER, ADMIN, MANAGER)
    if (
        authorization.membership.role !== "OWNER" &&
        authorization.membership.role !== "ADMIN" &&
        authorization.membership.role !== "MANAGER"
    ) {
        throw new ForbiddenError(
            authorization.membership.role === "DISPATCHER"
                ? "Dispatchers are not authorized to complete work orders."
                : "Only OWNER, ADMIN, and MANAGER roles are authorized to administratively complete work orders."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();

    // 3. Validate Input Payload
    const data = completeWorkOrderSchema.parse(input ?? {});

    // 4. Precondition Verification (§5.2)
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: trimmedWorkOrderId,
            workspaceId: authorization.workspace.id,
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

    // 5. Persistence of WorkOrder State Transition, Appointment Completion, Time Entry Closure & History in Atomic Transaction (§14)
    const now = new Date();
    return await prisma.$transaction(async (tx) => {
        // 5a. Delegate lifecycle transition to canonical Phase 1.6 status machine (Invariant 1)
        const updatedWorkOrder = await transitionWorkOrderStatus(
            authorization.workspace.id,
            trimmedWorkOrderId,
            { toStatus: "COMPLETED" },
            tx
        );

        // 5b. Appointment Completion Touchpoint (§6.1 Touchpoint 3)
        const appointments = await tx.scheduleAppointment.findMany({
            where: {
                workOrderId: trimmedWorkOrderId,
                workspaceId: authorization.workspace.id,
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
                workspaceId: authorization.workspace.id,
                appointmentId: appt.id,
                eventType: "COMPLETED",
                actorMemberId: authorization.membership.id,
                actorName: authorization.user.name || authorization.user.email,
                field: "status",
                oldValue: appt.status,
                newValue: "COMPLETED",
                metadata: {
                    resolutionNotes: data.resolutionNotes ?? null,
                },
            });
        }

        // 5c. Close remaining ACTIVE time entry (§7.3)
        const activeEntry = await tx.technicianTimeEntry.findFirst({
            where: {
                workspaceId: authorization.workspace.id,
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

        // 5d. Serialize resolution notes and completedByTechId into WorkOrderHistory.metadata (§8.1, §9.1)
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
                    completedByTechId: workOrder.assignedTechnicianId,
                    mediaUris: data.mediaUris && data.mediaUris.length > 0 ? data.mediaUris : undefined,
                }),
            },
        });

        // 5e. DTO Hygiene (§14 Step 7): Explicitly omit internal audit plumbing property before returning
        const { _historyRecordId, ...cleanWorkOrder } = updatedWorkOrder as any;
        return cleanWorkOrder as WorkOrderReadModel;
    });
}
