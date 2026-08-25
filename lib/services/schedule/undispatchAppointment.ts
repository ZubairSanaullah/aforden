import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { undispatchAppointmentSchema } from "./schedule.schemas";
import {
    ScheduleAppointmentNotFoundError,
    UndispatchNotAllowedError,
} from "./scheduleErrors";
import {
    toScheduleAppointmentReadModel,
    SCHEDULE_APPOINTMENT_INCLUDE,
} from "./scheduleReadModel";
import { recordScheduleHistory } from "./recordScheduleHistory";
import type { ScheduleAppointmentReadModel } from "./schedule.types";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

/**
 * Recalls an appointment from the field workforce back to PENDING_DISPATCH.
 *
 * Preconditions (Phase 1.8.1 §9.3):
 *   1. AUTH: Verify session & active workspace membership (`requireWorkspaceAuthorization`).
 *   2. PERMISSION: Enforce RBAC permission `SCHEDULER_UPDATE` (`assertPermission`).
 *   3. VALIDATION: Parse input payload via `undispatchAppointmentSchema`.
 *   4. RESOLUTION: Load appointment by `{ id, workspaceId }` -> `ScheduleAppointmentNotFoundError` (404).
 *   5. BUSINESS LOGIC (Strict Precondition Hierarchy):
 *      - Must be in `DISPATCHED` or `ACKNOWLEDGED` status -> `UndispatchNotAllowedError` (409) if already PENDING_DISPATCH or terminal.
 *      - Field execution guard: `fieldExecutionStartedAt !== null` -> `UndispatchNotAllowedError` (409).
 *   6. PERSISTENCE / TRANSACTION:
 *      - Update appointment: `dispatchStatus = PENDING_DISPATCH`, `undispatchedAt = now`, `undispatchedByMemberId = callerMemberId`.
 *      - Insert audit history: `eventType = UNDISPATCHED`, `field = dispatchStatus`, `oldValue = appt.dispatchStatus`, `newValue = PENDING_DISPATCH`, `metadata = { reason: data.reason }`.
 *   7. CANONICAL READ MODEL:
 *      - Return standard `ScheduleAppointmentReadModel`.
 */
export async function undispatchAppointment(
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
    const data = undispatchAppointmentSchema.parse(input);

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

    // --- 5. Precondition Hierarchy (§9.3) ---
    // 5.1 Dispatch Status Guard (Only DISPATCHED or ACKNOWLEDGED can be undispatched)
    if (appt.dispatchStatus !== "DISPATCHED" && appt.dispatchStatus !== "ACKNOWLEDGED") {
        throw new UndispatchNotAllowedError(
            `Appointment cannot be undispatched. Current dispatch status is ${appt.dispatchStatus} (must be DISPATCHED or ACKNOWLEDGED).`,
        );
    }

    // 5.2 Field Execution Guard (Phase 1.9 Execution Entry Boundary)
    if (appt.fieldExecutionStartedAt !== null) {
        throw new UndispatchNotAllowedError(
            "Appointment cannot be undispatched because technician has already begun field execution.",
        );
    }

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
                dispatchStatus: "PENDING_DISPATCH",
                undispatchedAt: now,
                undispatchedByMemberId: authorization.membership.id,
            },
            include: SCHEDULE_APPOINTMENT_INCLUDE,
        });

        // Record canonical operational history (§12 Step 6, §15)
        await recordScheduleHistory(tx, {
            workspaceId,
            appointmentId: appt.id,
            eventType: "UNDISPATCHED",
            actorMemberId: authorization.membership.id,
            actorName: authorization.user.name || authorization.user.email,
            field: "dispatchStatus",
            oldValue: appt.dispatchStatus,
            newValue: "PENDING_DISPATCH",
            metadata: {
                reason: data.reason ?? null,
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
                dispatchStatus: "PENDING_DISPATCH",
                dispatchedAt: now.toISOString(),
            },
        });

        return res;
    });

    // --- 7. Canonical Read Model Return ---
    return toScheduleAppointmentReadModel(updated);
}
