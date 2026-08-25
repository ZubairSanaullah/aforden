import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { rescheduleAppointmentSchema } from "./schedule.schemas";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleImmutableError,
    ScheduleInvalidTimeIntervalError,
} from "./scheduleErrors";
import {
    toScheduleAppointmentReadModel,
    SCHEDULE_APPOINTMENT_INCLUDE,
} from "./scheduleReadModel";
import { checkTechnicianAvailability } from "./checkTechnicianAvailability";
import { recordScheduleHistory } from "./recordScheduleHistory";
import type { ScheduleAppointmentReadModel } from "./schedule.types";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

const MIN_DURATION_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Reschedules an existing ScheduleAppointment to a new time window.
 *
 * 7-Step Pipeline (Phase 1.8.1 §5.4, §7.4, §12, §15.2):
 *   1. AUTH: Verify session & active workspace membership (`requireWorkspaceAuthorization`).
 *   2. PERMISSION: Enforce RBAC permission `SCHEDULER_UPDATE` (`assertPermission`).
 *   3. VALIDATION: Parse input payload via `rescheduleAppointmentSchema` (enforces mandatory reason).
 *   4. RESOLUTION: Load appointment by `{ id, workspaceId }` -> `ScheduleAppointmentNotFoundError` (404).
 *   5. BUSINESS LOGIC:
 *      - Immutability check: Reject if already `CANCELLED` or `COMPLETED` -> `ScheduleImmutableError` (409).
 *      - Defensive interval bounds: assert start < end, 5m to 14d -> `ScheduleInvalidTimeIntervalError` (400).
 *      - Conflict detection (§7.2 & §7.4): Run canonical half-open overlap query with `id: { not: appointmentId }` -> `ScheduleTechnicianConflictError` (409).
 *      - Timezone resolution (§6.2): Resolve ServiceLocation timezone or fall back to Workspace timezone.
 *   6. PERSISTENCE / TRANSACTION:
 *      - Update appointment: `status = RESCHEDULED`, reset `dispatchStatus = PENDING_DISPATCH` if previously dispatched/acknowledged.
 *      - Insert audit history: `eventType = RESCHEDULED` capturing old/new intervals and mandatory reason.
 *   7. CANONICAL READ MODEL:
 *      - Return standard `ScheduleAppointmentReadModel`.
 */
export async function rescheduleSchedule(
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
    const data = rescheduleAppointmentSchema.parse(input);

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
            `Appointment is in a terminal status (${appt.status}) and cannot be rescheduled.`,
        );
    }

    // 5.2 Defensive Interval Bounds Re-check
    const startMs = data.scheduledStart.getTime();
    const endMs = data.scheduledEnd.getTime();
    const durationMs = endMs - startMs;

    if (startMs >= endMs || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
        throw new ScheduleInvalidTimeIntervalError();
    }

    const durationMinutes = Math.round(durationMs / (1000 * 60));

    // 5.3 Timezone Resolution (Phase 1.8.1 §6.2)
    const locationTimezone = (appt.workOrder.location as any)?.timezone;
    const resolvedTimezone = locationTimezone || authorization.workspace?.timezone;

    if (!resolvedTimezone) {
        throw new Error("Workspace timezone is not configured.");
    }

    // 5.4 Comprehensive Technician Availability & Conflict Detection (§7, §8.1)
    await checkTechnicianAvailability(prisma, {
        workspaceId,
        technicianId: appt.technicianId,
        scheduledStart: data.scheduledStart,
        scheduledEnd: data.scheduledEnd,
        timezone: resolvedTimezone,
        excludeAppointmentId: appt.id,
    });

    // --- 6. Persistence in Atomic Transaction ---
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        // Update ScheduleAppointment record
        const res = await tx.scheduleAppointment.update({
            where: { id: appt.id },
            data: {
                scheduledStart: data.scheduledStart,
                scheduledEnd: data.scheduledEnd,
                durationMinutes,
                timezone: resolvedTimezone,
                status: "RESCHEDULED",
                dispatchStatus: "PENDING_DISPATCH", // Reset per §5.4 dispatch reset rule
            },
            include: SCHEDULE_APPOINTMENT_INCLUDE,
        });

        // Record canonical operational history (§12 Step 6, §15)
        await recordScheduleHistory(tx, {
            workspaceId,
            appointmentId: appt.id,
            eventType: "RESCHEDULED",
            actorMemberId: authorization.membership.id,
            actorName: authorization.user.name || authorization.user.email,
            field: "scheduledInterval",
            oldValue: JSON.stringify({
                scheduledStart: appt.scheduledStart,
                scheduledEnd: appt.scheduledEnd,
                durationMinutes: appt.durationMinutes,
            }),
            newValue: JSON.stringify({
                scheduledStart: data.scheduledStart,
                scheduledEnd: data.scheduledEnd,
                durationMinutes,
            }),
            metadata: {
                reason: data.reason,
                previousStatus: appt.status,
                previousDispatchStatus: appt.dispatchStatus,
            },
        });

        // Phase 1.13.9: Emit SCHEDULE_APPOINTMENT_RESCHEDULED in same transaction
        await emitNotificationEvent(tx, {
            workspaceId,
            eventType: NotificationEventType.SCHEDULE_APPOINTMENT_RESCHEDULED,
            sourceEntity: "ScheduleAppointment",
            sourceId: appt.id,
            actorMemberId: authorization.membership.id,
            payload: {
                appointmentId: appt.id,
                appointmentNumber: appt.appointmentNumber,
                workOrderId: appt.workOrderId,
                workOrderNumber: appt.workOrder.workOrderNumber,
                technicianId: appt.technicianId,
                previousStart: appt.scheduledStart.toISOString(),
                previousEnd: appt.scheduledEnd.toISOString(),
                newStart: res.scheduledStart.toISOString(),
                newEnd: res.scheduledEnd.toISOString(),
                rescheduleReason: data.reason,
            },
        });

        return res;
    });

    // --- 7. Canonical Read Model Return ---
    return toScheduleAppointmentReadModel(updated);
}
