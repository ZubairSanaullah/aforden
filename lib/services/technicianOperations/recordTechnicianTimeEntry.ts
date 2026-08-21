import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { ScheduleAppointmentNotFoundError } from "@/lib/services/schedule/scheduleErrors";
import {
    ActiveTimeEntryExistsError,
    TechnicianNotAssignedToWorkOrderError,
} from "./technicianOperationsErrors";
import {
    recordTechnicianTimeEntrySchema,
    toTechnicianTimeEntryReadModel,
    type TechnicianExecutionContext,
    type TechnicianTimeEntryReadModel,
} from "./technicianOperations.types";

/**
 * Manually records an operational field labor time entry (BREAK or ADMIN) for a WorkOrder.
 *
 * Operational & Invariant Rules:
 * - Section 2.2 (Invariant 2): Technician operations services are strictly bound to authenticated technician
 *   identities resolved via `resolveTechnicianContext()`. Only users with the `TECHNICIAN` role holding an active
 *   technician profile may invoke this service. Administrative overrides belong on administrative services.
 * - Section 7.1: Strictly operational labor duration. Scope exclusions: NO payroll, wage, rate, or billing fields.
 * - Section 7.2: Direct creation is strictly restricted to `BREAK` and `ADMIN` entry types.
 *   `TRAVEL` and `ON_SITE` are managed exclusively through lifecycle transitions (1.9.6 / 1.9.7).
 * - Section 7.3 (Single Active Entry Rule): If the technician already has an `ACTIVE` time entry,
 *   throws `ActiveTimeEntryExistsError` (409).
 * - Section 2.3 (Invariant 3): Unconditionally enforces that the caller is the assigned technician on the WorkOrder
 *   (`workOrder.assignedTechnicianId === context.technicianProfileId`).
 * - Invariant 2 & ForeignKey Safety: If `appointmentId` is supplied by the client, verifies it exists within the
 *   tenant, matches the target `workOrderId`, and is assigned to the calling technician (`technicianId === context.technicianProfileId`).
 * - Section 14: Time entry creation executes inside an atomic `prisma.$transaction`.
 */
export async function recordTechnicianTimeEntry(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown
): Promise<TechnicianTimeEntryReadModel> {
    // 1. Role Enforcement (Invariant 2 & Section 11)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can record time entries through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();

    // 2. Validate Input Payload (Strictly restricts entryType to BREAK or ADMIN)
    const data = recordTechnicianTimeEntrySchema.parse(input);

    // 3. Resolve WorkOrder & Unconditional Assignment Guard (§2.3 Invariant 3)
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
            "You are not assigned to execute this work order."
        );
    }

    // 4. Validate Client-Supplied appointmentId (Foreign Key Verification & Scoping)
    if (data.appointmentId) {
        const trimmedApptId = data.appointmentId.trim();
        const appointment = await prisma.scheduleAppointment.findFirst({
            where: {
                id: trimmedApptId,
                workOrderId: trimmedWorkOrderId,
                workspaceId: context.workspaceId,
            },
            select: {
                id: true,
                technicianId: true,
            },
        });

        if (!appointment) {
            throw new ScheduleAppointmentNotFoundError(
                "Scheduled appointment not found for this work order."
            );
        }

        if (appointment.technicianId !== context.technicianProfileId) {
            throw new TechnicianNotAssignedToWorkOrderError(
                "You are not assigned to this scheduled appointment."
            );
        }
    }

    // 5. Single Active Time Entry Rule (§7.3)
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

    // 6. Create Time Entry in Atomic Transaction (§14)
    const now = new Date();
    const created = await prisma.$transaction(async (tx) => {
        return tx.technicianTimeEntry.create({
            data: {
                workspaceId: context.workspaceId,
                technicianProfileId: context.technicianProfileId,
                workOrderId: trimmedWorkOrderId,
                appointmentId: data.appointmentId ? data.appointmentId.trim() : null,
                entryType: data.entryType,
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

    return toTechnicianTimeEntryReadModel(created);
}
