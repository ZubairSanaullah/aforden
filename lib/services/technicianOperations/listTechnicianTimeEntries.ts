import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { TechnicianNotAssignedToWorkOrderError } from "./technicianOperationsErrors";
import {
    toTechnicianTimeEntryReadModel,
    type TechnicianExecutionContext,
    type TechnicianTimeEntryReadModel,
} from "./technicianOperations.types";

/**
 * Lists technician time entries for a specified WorkOrder within the authorized workspace.
 *
 * Operational & Invariant Rules:
 * - Section 2.2 & 2.3: Strictly bound to the authenticated technician (role: TECHNICIAN).
 *   The caller must be assigned to the WorkOrder and can only view their own time entries.
 *   Administrative viewing is handled via `listTechnicianTimeEntriesAdmin`.
 * - Invariant 3: Unconditionally checks `workOrder.assignedTechnicianId === context.technicianProfileId`.
 * - Returns an array of canonical `TechnicianTimeEntryReadModel` objects.
 */
export async function listTechnicianTimeEntries(
    context: TechnicianExecutionContext,
    workOrderId: string
): Promise<TechnicianTimeEntryReadModel[]> {
    // 1. Role Guard (Invariant 2 & Section 11)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can view time entries through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();

    // 2. Resolve WorkOrder in Workspace & Unconditional Assignment Guard (§2.3 Invariant 3)
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: trimmedWorkOrderId,
            workspaceId: context.workspaceId,
        },
        select: {
            id: true,
            assignedTechnicianId: true,
        },
    });

    if (!workOrder) {
        throw new WorkOrderNotFoundError();
    }

    if (workOrder.assignedTechnicianId !== context.technicianProfileId) {
        throw new TechnicianNotAssignedToWorkOrderError(
            "You are not assigned to this work order."
        );
    }

    // 3. Query Time Entries Scoped to Technician Profile
    const entries = await prisma.technicianTimeEntry.findMany({
        where: {
            workspaceId: context.workspaceId,
            workOrderId: trimmedWorkOrderId,
            technicianProfileId: context.technicianProfileId,
        },
        orderBy: { startedAt: "desc" },
    });

    return entries.map(toTechnicianTimeEntryReadModel);
}
