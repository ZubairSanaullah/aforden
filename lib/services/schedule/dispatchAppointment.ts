import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { dispatchAppointmentSchema } from "./schedule.schemas";
import {
    ScheduleAppointmentNotFoundError,
    DispatchNotAllowedError,
} from "./scheduleErrors";
import {
    toScheduleAppointmentReadModel,
    SCHEDULE_APPOINTMENT_INCLUDE,
} from "./scheduleReadModel";
import {
    assertTechnicianActive,
    assertNoTechnicianConflicts,
} from "./conflictDetection";
import { recordScheduleHistory } from "./recordScheduleHistory";
import type { ScheduleAppointmentReadModel } from "./schedule.types";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

/**
 * Dispatches an active appointment to the assigned technician for field execution.
 *
 * Preconditions (Phase 1.8.1 §9.2):
 *   1. AUTH: Verify session & active workspace membership (`requireWorkspaceAuthorization`).
 *   2. PERMISSION: Enforce RBAC permission `SCHEDULER_UPDATE` (`assertPermission`).
 *   3. VALIDATION: Parse input payload via `dispatchAppointmentSchema`.
 *   4. RESOLUTION: Load appointment by `{ id, workspaceId }` -> `ScheduleAppointmentNotFoundError` (404).
 *   5. BUSINESS LOGIC (Strict Precondition Hierarchy):
 *      - Status must be `SCHEDULED` or `RESCHEDULED` -> `DispatchNotAllowedError` (409) if CANCELLED or COMPLETED.
 *      - Parent WorkOrder must be active (`OPEN`, `ASSIGNED`, `IN_PROGRESS`) -> `DispatchNotAllowedError` (409) if ON_HOLD, COMPLETED, CANCELLED.
 *      - Technician active, working hours, leave exceptions, and no overlapping conflicts:
 *        re-evaluated through `checkTechnicianAvailability` with `excludeAppointmentId: appt.id`.
 *   6. PERSISTENCE / TRANSACTION:
 *      - Update appointment: `dispatchStatus = DISPATCHED`, `dispatchedAt = now`, `dispatchedByMemberId = callerMemberId`, `undispatchedAt = null`, `undispatchedByMemberId = null`.
 *      - Insert audit history: `eventType = DISPATCHED`, `field = dispatchStatus`, `oldValue = appt.dispatchStatus`, `newValue = DISPATCHED`, `metadata = { notes: data.notes }`.
 *   7. CANONICAL READ MODEL:
 *      - Return standard `ScheduleAppointmentReadModel`.
 */
export async function dispatchAppointment(
    workspaceId: string,
    appointmentId: string,
    input: unknown = {},
): Promise<ScheduleAppointmentReadModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SCHEDULER_UPDATE Permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SCHEDULER_UPDATE,
    );

    // --- 3. Validate Input Payload ---
    const data = dispatchAppointmentSchema.parse(input);

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

    // --- 5. Precondition Hierarchy (§9.2) ---
    // 5.1 Status Guard (Only SCHEDULED or RESCHEDULED can be dispatched)
    if (appt.status !== "SCHEDULED" && appt.status !== "RESCHEDULED") {
        throw new DispatchNotAllowedError(
            `Appointment cannot be dispatched. Status must be SCHEDULED or RESCHEDULED (currently ${appt.status}).`,
        );
    }

    // 5.2 Parent WorkOrder Active Status Guard
    const activeWorkOrderStatuses = ["OPEN", "ASSIGNED", "IN_PROGRESS"];
    if (!activeWorkOrderStatuses.includes(appt.workOrder.status)) {
        throw new DispatchNotAllowedError(
            `Appointment cannot be dispatched because parent work order is ${appt.workOrder.status}.`,
        );
    }

    // 5.3 Technician Active Status Guard (§9.2 Step 4)
    await assertTechnicianActive(prisma, workspaceId, appt.technicianId);

    // 5.4 Hard Schedule Conflict Overlap Re-check (§9.2 Step 5)
    await assertNoTechnicianConflicts(prisma, {
        workspaceId,
        technicianId: appt.technicianId,
        scheduledStart: appt.scheduledStart,
        scheduledEnd: appt.scheduledEnd,
        excludeAppointmentId: appt.id,
    });

    // --- 6. Persistence in Atomic Transaction ---
    const now = new Date();
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        // Update ScheduleAppointment record
        const res = await tx.scheduleAppointment.update({
            where: { id: appt.id },
            data: {
                dispatchStatus: "DISPATCHED",
                dispatchedAt: now,
                dispatchedByMemberId: authorization.membership.id,
                undispatchedAt: null,
                undispatchedByMemberId: null,
            },
            include: SCHEDULE_APPOINTMENT_INCLUDE,
        });

        // Record canonical operational history (§12 Step 6, §15)
        await recordScheduleHistory(tx, {
            workspaceId,
            appointmentId: appt.id,
            eventType: "DISPATCHED",
            actorMemberId: authorization.membership.id,
            actorName: authorization.user.name || authorization.user.email,
            field: "dispatchStatus",
            oldValue: appt.dispatchStatus,
            newValue: "DISPATCHED",
            metadata: {
                notes: data.notes ?? null,
            },
        });

        // Phase 1.13.9: Emit SCHEDULE_DISPATCH_CHANGED in same transaction
        await emitNotificationEvent(tx, {
            workspaceId,
            eventType: NotificationEventType.SCHEDULE_DISPATCH_CHANGED,
            sourceEntity: "ScheduleAppointment",
            sourceId: appt.id,
            actorMemberId: authorization.membership.id,
            payload: {
                appointmentId: appt.id,
                appointmentNumber: appt.appointmentNumber,
                workOrderId: appt.workOrderId,
                technicianId: appt.technicianId,
                technicianName: (appt.technician as any)?.employee?.displayName || (appt as any).technicianName || "Technician",
                dispatchStatus: "DISPATCHED",
                dispatchedAt: now.toISOString(),
            },
        });

        return res;
    });

    // --- 7. Canonical Read Model Return ---
    return toScheduleAppointmentReadModel(updated);
}
