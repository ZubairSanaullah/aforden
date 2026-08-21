import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import {
    holdWorkOrderSchema,
    type TechnicianExecutionContext,
} from "./technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

/**
 * Places an in-progress WorkOrder on hold by the authenticated technician.
 *
 * Operational & Invariant Rules:
 * - Section 2.1 (Invariant 1: Single Authority Status Machine): Delegates lifecycle transition directly
 *   to Phase 1.6 `transitionWorkOrderStatus(workspaceId, workOrderId, { toStatus: "ON_HOLD", holdReason })`.
 *   This records the `holdReason` and writes `WorkOrderHistory`.
 * - Section 5.1 & Section 7.3: Automatically closes any open `ACTIVE` time entry for this technician
 *   (`endedAt = now()`, computing `durationMinutes`, `status = "COMPLETED"`).
 * - Section 14: Time entry closure executes in an atomic `prisma.$transaction`.
 */
export async function holdTechnicianWorkOrder(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown
): Promise<WorkOrderReadModel> {
    // 1. Role Enforcement (Invariant 2)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can hold work orders through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();

    // 2. Validate Input Payload (holdReason required)
    const data = holdWorkOrderSchema.parse(input);

    // 3. Delegate State Machine Transition to Phase 1.6 Service (Invariant 1)
    const updatedWorkOrder = await transitionWorkOrderStatus(
        context.workspaceId,
        trimmedWorkOrderId,
        {
            toStatus: "ON_HOLD",
            holdReason: data.holdReason,
        }
    );

    // 4. Close Active Time Entry in Atomic Transaction (§7.3, §14)
    const now = new Date();
    await prisma.$transaction(async (tx) => {
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
    });

    return updatedWorkOrder;
}
