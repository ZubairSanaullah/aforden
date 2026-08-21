import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import {
    TimeEntryNotFoundError,
    TimeEntryImmutableError,
} from "./technicianOperationsErrors";
import {
    updateTechnicianTimeEntrySchema,
    toTechnicianTimeEntryReadModel,
    type TechnicianExecutionContext,
    type TechnicianTimeEntryReadModel,
} from "./technicianOperations.types";

/**
 * Updates or closes an active operational technician time entry.
 *
 * Operational & Invariant Rules:
 * - Section 2.2 (Invariant 2): Bound strictly to the authenticated technician (role: TECHNICIAN).
 *   Administrative edits to completed entries are handled via `updateTechnicianTimeEntryAdmin`.
 * - Section 7.1: Scope exclusions: strictly operational duration, NO payroll/billing fields.
 * - Section 7.3: Closing an ACTIVE entry sets `endedAt` (default now()), sets `status = COMPLETED`,
 *   and calculates `durationMinutes = Math.max(0, Math.round((endedAt - startedAt) / 60000))`.
 * - Section 10 & 11.1 (Immutability & RBAC):
 *   - A `TECHNICIAN` can only close or annotate their own `ACTIVE` time entry.
 *   - Attempting to modify a `COMPLETED` entry as a `TECHNICIAN` throws `TimeEntryImmutableError` (409).
 *   - Attempting to modify another technician's entry throws `ForbiddenError` (403).
 * - Section 14: Mutation executes in an atomic `prisma.$transaction`.
 */
export async function updateTechnicianTimeEntry(
    context: TechnicianExecutionContext,
    workOrderId: string,
    timeEntryId: string,
    input: unknown = {}
): Promise<TechnicianTimeEntryReadModel> {
    // 1. Role Enforcement (Invariant 2 & Section 11)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can update time entries through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    if (!timeEntryId || typeof timeEntryId !== "string" || !timeEntryId.trim()) {
        throw new TimeEntryNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();
    const trimmedTimeEntryId = timeEntryId.trim();

    // 2. Validate Input Payload
    const data = updateTechnicianTimeEntrySchema.parse(input ?? {});

    // 3. Resolve WorkOrder in Workspace
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: trimmedWorkOrderId,
            workspaceId: context.workspaceId,
        },
        select: { id: true },
    });

    if (!workOrder) {
        throw new WorkOrderNotFoundError();
    }

    // 4. Resolve Target Time Entry
    const timeEntry = await prisma.technicianTimeEntry.findFirst({
        where: {
            id: trimmedTimeEntryId,
            workspaceId: context.workspaceId,
            workOrderId: trimmedWorkOrderId,
        },
    });

    if (!timeEntry) {
        throw new TimeEntryNotFoundError();
    }

    // 5. Technician Ownership & Immutability Enforcement (§10, §11.1)
    if (timeEntry.technicianProfileId !== context.technicianProfileId) {
        throw new ForbiddenError(
            "You are only authorized to modify your own time entries."
        );
    }

    if (timeEntry.status === "COMPLETED") {
        throw new TimeEntryImmutableError(
            "Completed time entries are immutable and cannot be modified."
        );
    }

    // 6. Compute Updates & Duration for Closing Active Entry (§7.3)
    const now = new Date();
    const endedAt = data.endedAt ? new Date(data.endedAt) : now;
    const durationMinutes = Math.max(
        0,
        Math.round((endedAt.getTime() - timeEntry.startedAt.getTime()) / 60000)
    );

    const updateData: {
        status: "COMPLETED";
        endedAt: Date;
        durationMinutes: number;
        notes?: string | null;
        metadata?: any;
    } = {
        status: "COMPLETED",
        endedAt,
        durationMinutes,
    };

    if (data.notes !== undefined) {
        updateData.notes = data.notes;
    }

    if (data.metadata !== undefined) {
        updateData.metadata = data.metadata ? (data.metadata as any) : null;
    }

    // 7. Atomic Persistence (§14)
    const updated = await prisma.$transaction(async (tx) => {
        return tx.technicianTimeEntry.update({
            where: { id: timeEntry.id },
            data: updateData,
        });
    });

    return toTechnicianTimeEntryReadModel(updated);
}
