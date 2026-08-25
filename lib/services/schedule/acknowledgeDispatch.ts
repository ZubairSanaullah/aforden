import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { acknowledgeDispatchSchema } from "./schedule.schemas";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleInvalidStatusTransitionError,
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
 * =============================================================================
 * PHASE 1.9 BOUNDARY CONTRACT ENTRY POINT
 * =============================================================================
 * This function is the ONLY sanctioned write path into ScheduleAppointment for
 * future Phase 1.9 Technician Execution code.
 *
 * It allows the assigned technician to acknowledge receipt of dispatch via mobile or web.
 *
 * Preconditions (Phase 1.8.1 §2.1, §9.1):
 *   1. AUTH: Verify session & active workspace membership (`requireWorkspaceAuthorization`).
 *   2. PERMISSION & IDENTITY:
 *      - Must hold SCHEDULER_VIEW permission.
 *      - If role is TECHNICIAN, caller MUST be the technician assigned to this appointment
 *        (resolved via employee.workspaceMemberId === membership.id).
 *   3. VALIDATION: Parse input payload via `acknowledgeDispatchSchema`.
 *   4. RESOLUTION: Load appointment by `{ id, workspaceId }` -> `ScheduleAppointmentNotFoundError` (404).
 *   5. BUSINESS LOGIC:
 *      - Appointment must be in `DISPATCHED` status -> `ScheduleInvalidStatusTransitionError` (409) if not DISPATCHED.
 *   6. PERSISTENCE / TRANSACTION:
 *      - Update appointment: `dispatchStatus = ACKNOWLEDGED`.
 *      - Insert audit history: `eventType = UPDATED`, `field = dispatchStatus`, `oldValue = DISPATCHED`, `newValue = ACKNOWLEDGED`.
 *   7. CANONICAL READ MODEL:
 *      - Return standard `ScheduleAppointmentReadModel`.
 */
export async function acknowledgeDispatch(
    workspaceId: string,
    appointmentId: string,
    input: unknown = {},
): Promise<ScheduleAppointmentReadModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SCHEDULER_VIEW Permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SCHEDULER_VIEW,
    );

    // --- 3. Validate Input Payload ---
    const data = acknowledgeDispatchSchema.parse(input);

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

    // --- 5. Authorization Scoping: Technician Identity Verification ---
    // If caller has TECHNICIAN role, ensure they are acknowledging their own appointment
    if (authorization.membership.role === "TECHNICIAN") {
        const callerTechnician = await prisma.technicianProfile.findFirst({
            where: {
                employee: {
                    workspaceMemberId: authorization.membership.id,
                },
            },
            select: { id: true },
        });

        if (!callerTechnician || callerTechnician.id !== appt.technicianId) {
            throw new ForbiddenError(
                "You are not authorized to acknowledge dispatch for appointments assigned to another technician.",
            );
        }
    }

    // --- 6. Precondition: State Machine Guard (§5.3, §9.1) ---
    if (appt.dispatchStatus !== "DISPATCHED") {
        throw new ScheduleInvalidStatusTransitionError(
            `Appointment must be in DISPATCHED status to acknowledge receipt (currently ${appt.dispatchStatus}).`,
            appt.dispatchStatus,
            "ACKNOWLEDGED",
        );
    }

    // --- 7. Persistence in Atomic Transaction ---
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        const res = await tx.scheduleAppointment.update({
            where: { id: appt.id },
            data: {
                dispatchStatus: "ACKNOWLEDGED",
            },
            include: SCHEDULE_APPOINTMENT_INCLUDE,
        });

        // Record canonical operational history (§12 Step 6, §15)
        await recordScheduleHistory(tx, {
            workspaceId,
            appointmentId: appt.id,
            eventType: "UPDATED",
            actorMemberId: authorization.membership.id,
            actorName: authorization.user.name || authorization.user.email,
            field: "dispatchStatus",
            oldValue: "DISPATCHED",
            newValue: "ACKNOWLEDGED",
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
                dispatchStatus: "ACKNOWLEDGED",
                dispatchedAt: appt.dispatchedAt ? appt.dispatchedAt.toISOString() : new Date().toISOString(),
            },
        });

        return res;
    });

    return toScheduleAppointmentReadModel(updated);
}
