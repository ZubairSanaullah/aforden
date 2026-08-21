import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import {
    resumeWorkOrderSchema,
    type TechnicianExecutionContext,
} from "./technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

/**
 * Resumes an on-hold WorkOrder back to in-progress execution by the authenticated technician.
 *
 * Operational & Invariant Rules:
 * - Section 2.1 (Invariant 1: Single Authority Status Machine): Delegates lifecycle transition directly
 *   to Phase 1.6 `transitionWorkOrderStatus(workspaceId, workOrderId, { toStatus: "IN_PROGRESS" })`.
 *   This clears the `holdReason` and writes `WorkOrderHistory`.
 * - Section 5.1 & Section 7.3: Opens a new `ACTIVE` `ON_SITE` time entry for this technician/workOrder.
 * - Section 14: Time entry creation executes in an atomic `prisma.$transaction`.
 */
export async function resumeTechnicianWorkOrder(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown = {}
): Promise<WorkOrderReadModel> {
    // 1. Role Enforcement (Invariant 2)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can resume work orders through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();

    // 2. Validate Input Payload
    const data = resumeWorkOrderSchema.parse(input ?? {});

    // 3. Delegate State Machine Transition and Create Active Time Entry in Unified Atomic Transaction (§7.3, §14)
    const now = new Date();
    return await prisma.$transaction(async (tx) => {
        const updatedWorkOrder = await transitionWorkOrderStatus(
            context.workspaceId,
            trimmedWorkOrderId,
            { toStatus: "IN_PROGRESS" },
            tx
        );

        const appointment = await tx.scheduleAppointment.findFirst({
            where: {
                workOrderId: trimmedWorkOrderId,
                workspaceId: context.workspaceId,
                technicianId: context.technicianProfileId,
                status: { not: "CANCELLED" },
            },
            select: { id: true },
        });

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
