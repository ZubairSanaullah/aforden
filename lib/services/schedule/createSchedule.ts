import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createScheduleAppointmentSchema } from "./schedule.schemas";
import {
    ScheduleWorkOrderNotFoundError,
    ScheduleWorkOrderNotEligibleError,
    ScheduleWorkOrderNotAssignedError,
    ScheduleTechnicianNotFoundError,
    ScheduleTechnicianMismatchError,
    ScheduleTechnicianNotEligibleError,
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

const MAX_NUMBER_GENERATION_ATTEMPTS = 5;
const MIN_DURATION_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Creates and books a new ScheduleAppointment within an authorized workspace.
 *
 * 7-Step Pipeline (Phase 1.8.1 §12):
 *   1. AUTH: Verify session & active workspace membership (`requireWorkspaceAuthorization`).
 *   2. PERMISSION: Enforce RBAC permission `SCHEDULER_CREATE` (`assertPermission`).
 *   3. VALIDATION: Parse input payload through `createScheduleAppointmentSchema`.
 *   4. RESOLUTION:
 *      - Tenant-scoped WorkOrder lookup (`findFirst({ where: { id, workspaceId } })`):
 *        Missing -> `ScheduleWorkOrderNotFoundError` (404).
 *      - Tenant-scoped TechnicianProfile lookup (`findFirst({ where: { id, employee: { workspaceId } } })`):
 *        Missing -> `ScheduleTechnicianNotFoundError` (404).
 *   5. BUSINESS LOGIC (Strict Evaluation Order):
 *      - WorkOrder terminal status check (COMPLETED/CANCELLED -> 422 `ScheduleWorkOrderNotEligibleError`).
 *      - WorkOrder assignment precondition (§2.2):
 *        - `workOrder.assignedTechnicianId === null` -> 422 `ScheduleWorkOrderNotAssignedError`.
 *        - `workOrder.assignedTechnicianId !== data.technicianId` -> 422 `ScheduleTechnicianMismatchError`.
 *        - Does NOT mutate WorkOrder.
 *      - Technician eligibility check (`employee.status === "ACTIVE"` -> 422 `ScheduleTechnicianNotEligibleError`).
 *      - Time interval bounds check (`start < end`, 5m to 14d -> 400 `ScheduleInvalidTimeIntervalError`).
 *      - Overlap conflict detection (§7.2):
 *        - Half-open interval query: `A.start < B.end AND B.start < A.end` for active status in (SCHEDULED, RESCHEDULED).
 *        - Any match -> 409 `ScheduleTechnicianConflictError`.
 *      - Timezone resolution (§6.2):
 *        - `data.timezone || authorization.workspace?.timezone || "UTC"`.
 *   6. PERSISTENCE / TRANSACTION:
 *      - Atomically generate `appointmentNumber` (`APT-YYYY-XXXXXX`).
 *      - Insert `ScheduleAppointment` (`status = SCHEDULED`, `dispatchStatus = PENDING_DISPATCH`).
 *      - Insert `ScheduleAppointmentHistory` (`eventType = CREATED`).
 *   7. CANONICAL READ MODEL:
 *      - Return standard `ScheduleAppointmentReadModel` via `toScheduleAppointmentReadModel()`.
 */
export async function createSchedule(
    workspaceId: string,
    input: unknown,
): Promise<ScheduleAppointmentReadModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SCHEDULER_CREATE Permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SCHEDULER_CREATE,
    );

    // --- 3. Validate Input Payload (Schema Bounds & Types) ---
    const data = createScheduleAppointmentSchema.parse(input);

    // --- 4. Tenant-Scoped Entity Resolution ---
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: data.workOrderId,
            workspaceId,
        },
        include: {
            customer: true,
            location: true,
            asset: true,
        },
    });

    if (!workOrder) {
        throw new ScheduleWorkOrderNotFoundError();
    }

    // --- 5. Business Logic Validation & Invariants ---
    // 5.1 WorkOrder Terminal Status Guard
    if (workOrder.status === "COMPLETED" || workOrder.status === "CANCELLED") {
        throw new ScheduleWorkOrderNotEligibleError();
    }

    // 5.2 WorkOrder Assignment Precondition (§2.2)
    if (workOrder.assignedTechnicianId === null) {
        throw new ScheduleWorkOrderNotAssignedError();
    }

    if (workOrder.assignedTechnicianId !== data.technicianId) {
        throw new ScheduleTechnicianMismatchError();
    }

    // 5.3 Defensive Interval Bounds Re-check
    const startMs = data.scheduledStart.getTime();
    const endMs = data.scheduledEnd.getTime();
    const durationMs = endMs - startMs;

    if (startMs >= endMs || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
        throw new ScheduleInvalidTimeIntervalError();
    }

    const durationMinutes = Math.round(durationMs / (1000 * 60));

    // 5.4 Timezone Resolution (Phase 1.8.1 §6.2)
    // Hierarchy: 1. ServiceLocation timezone -> 2. Workspace timezone
    const locationTimezone = (workOrder.location as any)?.timezone;
    const resolvedTimezone = locationTimezone || authorization.workspace?.timezone;

    if (!resolvedTimezone) {
        throw new Error("Workspace timezone is not configured.");
    }

    // 5.5 Comprehensive Technician Availability & Conflict Detection (§7, §8.1)
    await checkTechnicianAvailability(prisma, {
        workspaceId,
        technicianId: data.technicianId,
        scheduledStart: data.scheduledStart,
        scheduledEnd: data.scheduledEnd,
        timezone: resolvedTimezone,
    });

    // --- 6. Persistence in Atomic Transaction ---
    const currentYear = new Date(data.scheduledStart).getFullYear() || new Date().getFullYear();
    const prefix = `APT-${currentYear}-`;

    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_NUMBER_GENERATION_ATTEMPTS; attempt++) {
        try {
            const created = await runTx(async (tx) => {
                // Compute next sequential appointment number
                const latest = await tx.scheduleAppointment.findFirst({
                    where: {
                        workspaceId,
                        appointmentNumber: {
                            startsWith: prefix,
                        },
                    },
                    orderBy: {
                        appointmentNumber: "desc",
                    },
                    select: {
                        appointmentNumber: true,
                    },
                });

                let nextSeq = 1;
                if (latest?.appointmentNumber) {
                    const rawSeq = latest.appointmentNumber.replace(prefix, "");
                    const parsedSeq = parseInt(rawSeq, 10);
                    if (!isNaN(parsedSeq)) {
                        nextSeq = parsedSeq + 1;
                    }
                }

                const appointmentNumber = `${prefix}${String(nextSeq).padStart(6, "0")}`;

                // Insert ScheduleAppointment record
                const appt = await tx.scheduleAppointment.create({
                    data: {
                        workspaceId,
                        appointmentNumber,
                        workOrderId: data.workOrderId,
                        technicianId: data.technicianId,
                        scheduledStart: data.scheduledStart,
                        scheduledEnd: data.scheduledEnd,
                        durationMinutes,
                        timezone: resolvedTimezone,
                        status: "SCHEDULED",
                        dispatchStatus: "PENDING_DISPATCH",
                        notes: data.notes ?? null,
                        metadata: data.metadata ?? null,
                    },
                    include: SCHEDULE_APPOINTMENT_INCLUDE,
                });

                // Record canonical operational history (§12 Step 6, §15)
                await recordScheduleHistory(tx, {
                    workspaceId,
                    appointmentId: appt.id,
                    eventType: "CREATED",
                    actorMemberId: authorization.membership.id,
                    actorName: authorization.user.name || authorization.user.email,
                    metadata: {
                        scheduledStart: data.scheduledStart,
                        scheduledEnd: data.scheduledEnd,
                        durationMinutes,
                        technicianId: data.technicianId,
                    },
                });

                // Phase 1.13.9: Emit SCHEDULE_APPOINTMENT_SCHEDULED in same transaction
                await emitNotificationEvent(tx, {
                    workspaceId,
                    eventType: NotificationEventType.SCHEDULE_APPOINTMENT_SCHEDULED,
                    sourceEntity: "ScheduleAppointment",
                    sourceId: appt.id,
                    actorMemberId: authorization.membership.id,
                    payload: {
                        appointmentId: appt.id,
                        appointmentNumber: appt.appointmentNumber,
                        workOrderId: appt.workOrderId,
                        workOrderNumber: workOrder.workOrderNumber,
                        technicianId: appt.technicianId,
                        technicianName: (appt.technician as any)?.employee?.displayName || (appt as any).technicianName || "Technician",
                        scheduledStart: appt.scheduledStart.toISOString(),
                        scheduledEnd: appt.scheduledEnd.toISOString(),
                        customerId: workOrder.customerId,
                    },
                });

                return appt;
            });

            // --- 7. Canonical Read Model Return ---
            return toScheduleAppointmentReadModel(created);
        } catch (err: any) {
            lastError = err;
            if (err?.code === "P2002" && attempt < MAX_NUMBER_GENERATION_ATTEMPTS - 1) {
                continue; // Retry with next sequence number on concurrency race
            }
            throw err;
        }
    }

    throw lastError;
}
