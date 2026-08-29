import type { ScheduleAppointmentReadModel } from "@/lib/services/schedule/schedule.types";

/**
 * Canonical external representation of a Schedule Appointment resource.
 *
 * Privacy & Security Invariants:
 * - Excludes `workspaceId` (Tenant boundary security invariant)
 * - Excludes `dispatchedByMemberId` & `dispatchedByName` (Internal staff dispatch audit IDs)
 * - Excludes `undispatchedAt` & `undispatchedByMemberId` (Internal dispatch lifecycle audit metadata)
 * - Excludes `notes` (Internal private dispatcher scratchpad)
 * - Excludes `metadata` (Internal system JSON metadata dictionary)
 */
export interface PublicScheduleDto {
    id: string;
    appointmentNumber: string;
    workOrderId: string;
    technicianId: string;
    scheduledStart: string;
    scheduledEnd: string;
    durationMinutes: number;
    timezone: string;
    status: string;
    dispatchStatus: string;
    dispatchedAt: string | null;
    fieldExecutionStartedAt: string | null;
    cancellationReason: string | null;
    createdAt: string;
    updatedAt: string;
}

export const APPROVED_PUBLIC_SCHEDULE_DTO_KEYS = [
    "id",
    "appointmentNumber",
    "workOrderId",
    "technicianId",
    "scheduledStart",
    "scheduledEnd",
    "durationMinutes",
    "timezone",
    "status",
    "dispatchStatus",
    "dispatchedAt",
    "fieldExecutionStartedAt",
    "cancellationReason",
    "createdAt",
    "updatedAt",
] as const;

/**
 * Maps an internal ScheduleAppointmentReadModel to the canonical PublicScheduleDto.
 */
export function toPublicScheduleDto(
    item: ScheduleAppointmentReadModel | any,
): PublicScheduleDto {
    return {
        id: item.id,
        appointmentNumber: item.appointmentNumber,
        workOrderId: item.workOrderId,
        technicianId: item.technicianId,
        scheduledStart: new Date(item.scheduledStart).toISOString(),
        scheduledEnd: new Date(item.scheduledEnd).toISOString(),
        durationMinutes: item.durationMinutes,
        timezone: item.timezone,
        status: item.status,
        dispatchStatus: item.dispatchStatus,
        dispatchedAt: item.dispatchedAt ? new Date(item.dispatchedAt).toISOString() : null,
        fieldExecutionStartedAt: item.fieldExecutionStartedAt
            ? new Date(item.fieldExecutionStartedAt).toISOString()
            : null,
        cancellationReason: item.cancellationReason ?? null,
        createdAt: new Date(item.createdAt).toISOString(),
        updatedAt: new Date(item.updatedAt).toISOString(),
    };
}
