import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateScheduleAppointmentSchema } from "./schedule.schemas";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleImmutableError,
} from "./scheduleErrors";
import {
    toScheduleAppointmentReadModel,
    SCHEDULE_APPOINTMENT_INCLUDE,
} from "./scheduleReadModel";
import { recordScheduleHistory } from "./recordScheduleHistory";
import type { ScheduleAppointmentReadModel } from "./schedule.types";

/**
 * Updates non-temporal metadata (notes, metadata) on an existing ScheduleAppointment.
 *
 * Locked Invariants (Phase 1.8.1 §15.7):
 *   1. AUTH: Verify session & active workspace membership (`requireWorkspaceAuthorization`).
 *   2. PERMISSION: Enforce RBAC permission `SCHEDULER_UPDATE` (`assertPermission`).
 *   3. VALIDATION: Parse input payload via `updateScheduleAppointmentSchema`.
 *   4. RESOLUTION: Load appointment by `{ id, workspaceId }` -> `ScheduleAppointmentNotFoundError` (404).
 *   5. BUSINESS LOGIC:
 *      - Immutability check: Reject if `CANCELLED` or `COMPLETED` -> `ScheduleImmutableError` (409).
 *      - Does NOT touch scheduledStart, scheduledEnd, durationMinutes, status, or dispatchStatus.
 *   6. PERSISTENCE / TRANSACTION:
 *      - Update appointment notes and metadata.
 *      - Insert audit history: `eventType = UPDATED` capturing modified fields.
 *   7. CANONICAL READ MODEL:
 *      - Return standard `ScheduleAppointmentReadModel`.
 */
export async function updateSchedule(
    workspaceId: string,
    appointmentId: string,
    input: unknown,
): Promise<ScheduleAppointmentReadModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SCHEDULER_UPDATE Permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SCHEDULER_UPDATE,
    );

    // --- 3. Validate Input Payload ---
    const data = updateScheduleAppointmentSchema.parse(input);

    // --- 4. Tenant-Scoped Entity Resolution ---
    const appt = await prisma.scheduleAppointment.findFirst({
        where: {
            id: appointmentId,
            workspaceId,
        },
        include: SCHEDULE_APPOINTMENT_INCLUDE,
    });

    if (!appt) {
        throw new ScheduleAppointmentNotFoundError();
    }

    // --- 5. Business Logic Validation & Invariants ---
    // 5.1 Immutability Guard (Terminal Statuses CANCELLED / COMPLETED)
    if (appt.status === "CANCELLED" || appt.status === "COMPLETED") {
        throw new ScheduleImmutableError(
            `Appointment is in a terminal status (${appt.status}) and cannot be modified.`,
        );
    }

    // --- 6. Persistence in Atomic Transaction ---
    const nextNotes = data.notes !== undefined ? data.notes : appt.notes;
    const nextMetadata = data.metadata !== undefined ? data.metadata : appt.metadata;

    const changedFields: string[] = [];
    if (data.notes !== undefined && data.notes !== appt.notes) {
        changedFields.push("notes");
    }
    if (data.metadata !== undefined && JSON.stringify(data.metadata) !== JSON.stringify(appt.metadata)) {
        changedFields.push("metadata");
    }

    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        const res = await tx.scheduleAppointment.update({
            where: { id: appt.id },
            data: {
                notes: nextNotes,
                metadata: nextMetadata,
            },
            include: SCHEDULE_APPOINTMENT_INCLUDE,
        });

        // Record canonical operational history — one row per changed field (§12 Step 6, §15)
        if (data.notes !== undefined && data.notes !== appt.notes) {
            await recordScheduleHistory(tx, {
                workspaceId,
                appointmentId: appt.id,
                eventType: "UPDATED",
                actorMemberId: authorization.membership.id,
                actorName: authorization.user.name || authorization.user.email,
                field: "notes",
                oldValue: appt.notes ?? null,
                newValue: nextNotes ?? null,
                metadata: { field: "notes" },
            });
        }

        if (data.metadata !== undefined && JSON.stringify(data.metadata) !== JSON.stringify(appt.metadata)) {
            await recordScheduleHistory(tx, {
                workspaceId,
                appointmentId: appt.id,
                eventType: "UPDATED",
                actorMemberId: authorization.membership.id,
                actorName: authorization.user.name || authorization.user.email,
                field: "metadata",
                oldValue: appt.metadata ? JSON.stringify(appt.metadata) : null,
                newValue: nextMetadata ? JSON.stringify(nextMetadata) : null,
                metadata: { field: "metadata" },
            });
        }

        return res;
    });

    // --- 7. Canonical Read Model Return ---
    return toScheduleAppointmentReadModel(updated);
}
