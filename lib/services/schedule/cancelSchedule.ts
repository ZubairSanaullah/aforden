import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { cancelAppointmentSchema } from "./schedule.schemas";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleImmutableError,
    ScheduleMissingCancellationReasonError,
    ScheduleWorkOrderNotEligibleError,
} from "./scheduleErrors";
import {
    toScheduleAppointmentReadModel,
    SCHEDULE_APPOINTMENT_INCLUDE,
} from "./scheduleReadModel";
import { recordScheduleHistory } from "./recordScheduleHistory";
import type { ScheduleAppointmentReadModel } from "./schedule.types";

/**
 * Cancels an active ScheduleAppointment with mandatory reason tracking.
 *
 * Locked Execution Order (Phase 1.8.1 §5.4, §13, §15.5):
 *   1. AUTH: Verify session & active workspace membership (`requireWorkspaceAuthorization`).
 *   2. PERMISSION: Enforce RBAC permission `SCHEDULER_DELETE` (`assertPermission`).
 *   3. VALIDATION: Parse input payload via `cancelAppointmentSchema` (mandatory reason).
 *   4. RESOLUTION: Load appointment by `{ id, workspaceId }` -> `ScheduleAppointmentNotFoundError` (404).
 *   5. BUSINESS LOGIC:
 *      - Immutability check: Reject if already `CANCELLED` or `COMPLETED` -> `ScheduleImmutableError` (409).
 *      - Defensive reason check: Assert cancellation reason is non-empty -> `ScheduleMissingCancellationReasonError` (400).
 *      - WorkOrder status guard (§5.4): Reject if parent WorkOrder is already `COMPLETED` -> `ScheduleWorkOrderNotEligibleError` (422).
 *   6. PERSISTENCE / TRANSACTION:
 *      - Update appointment: `status = CANCELLED`, `dispatchStatus = PENDING_DISPATCH`, `cancellationReason`.
 *      - Insert audit history: `eventType = CANCELLED` capturing cancellation reason.
 *   7. CANONICAL READ MODEL:
 *      - Return standard `ScheduleAppointmentReadModel`.
 */
export async function cancelSchedule(
    workspaceId: string,
    appointmentId: string,
    input: unknown,
): Promise<ScheduleAppointmentReadModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SCHEDULER_DELETE Permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SCHEDULER_DELETE,
    );

    // --- 3. Validate Input Payload ---
    const data = cancelAppointmentSchema.parse(input);

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
            `Appointment is already in a terminal status (${appt.status}) and cannot be cancelled.`,
        );
    }

    // 5.2 Defensive Cancellation Reason Check
    if (!data.cancellationReason || !data.cancellationReason.trim()) {
        throw new ScheduleMissingCancellationReasonError();
    }

    // 5.3 WorkOrder Terminal Status Precondition (§5.4 note)
    if (appt.workOrder.status === "COMPLETED") {
        throw new ScheduleWorkOrderNotEligibleError(
            "Cannot cancel an appointment for a work order that has already been completed.",
        );
    }

    // --- 6. Persistence in Atomic Transaction ---
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        // Update ScheduleAppointment record
        const res = await tx.scheduleAppointment.update({
            where: { id: appt.id },
            data: {
                status: "CANCELLED",
                dispatchStatus: "PENDING_DISPATCH",
                cancellationReason: data.cancellationReason.trim(),
            },
            include: SCHEDULE_APPOINTMENT_INCLUDE,
        });

        // Record canonical operational history (§12 Step 6, §15)
        await recordScheduleHistory(tx, {
            workspaceId,
            appointmentId: appt.id,
            eventType: "CANCELLED",
            actorMemberId: authorization.membership.id,
            actorName: authorization.user.name || authorization.user.email,
            field: "status",
            oldValue: appt.status,
            newValue: "CANCELLED",
            metadata: {
                cancellationReason: data.cancellationReason.trim(),
                previousDispatchStatus: appt.dispatchStatus,
            },
        });

        return res;
    });

    // --- 7. Canonical Read Model Return ---
    return toScheduleAppointmentReadModel(updated);
}
