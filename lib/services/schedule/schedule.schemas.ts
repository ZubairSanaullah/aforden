/**
 * Scheduling & Dispatch Domain Validation Schemas
 *
 * Architectural Governance (Phase 1.8.1 §12 Step 3):
 * - Route handlers and service entry points delegate ALL shape, type, and boundary
 *   validation directly to these Zod schemas.
 * - No duplicate validation logic should be written in HTTP route handlers.
 * - Pure shape and range validation only (e.g. interval bounds, required reasons).
 * - Business logic (conflict detection, tenant isolation, technician eligibility)
 *   is executed downstream in dedicated service layers (Phase 1.8.1 §12 Step 5).
 */

import { z } from "zod";

export const SCHEDULE_STATUSES = [
    "SCHEDULED",
    "RESCHEDULED",
    "CANCELLED",
    "COMPLETED",
] as const;

export type ScheduleStatusType = (typeof SCHEDULE_STATUSES)[number];

export const scheduleStatusSchema = z.enum(SCHEDULE_STATUSES, {
    error: "Status must be one of: SCHEDULED, RESCHEDULED, CANCELLED, COMPLETED.",
});

export const DISPATCH_STATUSES = [
    "PENDING_DISPATCH",
    "DISPATCHED",
    "ACKNOWLEDGED",
] as const;

export type DispatchStatusType = (typeof DISPATCH_STATUSES)[number];

export const dispatchStatusSchema = z.enum(DISPATCH_STATUSES, {
    error: "Dispatch status must be one of: PENDING_DISPATCH, DISPATCHED, ACKNOWLEDGED.",
});

export const SCHEDULE_SORT_FIELDS = [
    "scheduledStart",
    "scheduledEnd",
    "createdAt",
    "updatedAt",
    "status",
] as const;

export type ScheduleSortFieldType = (typeof SCHEDULE_SORT_FIELDS)[number];

// Duration bounds per Phase 1.8.1 §6.3:
// Minimum 5 minutes (300,000 ms)
// Maximum 14 days (14 * 24 * 60 * 60 * 1000 = 1,209,600,000 ms)
const MIN_DURATION_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Validates metadata JSON structure (max depth 2, max size 32KB).
 */
function validateMetadataObject(val: unknown): boolean {
    if (val === null || val === undefined) return true;
    if (typeof val !== "object" || Array.isArray(val)) return false;

    try {
        const serialized = JSON.stringify(val);
        if (serialized.length > 32768) return false;
    } catch {
        return false;
    }

    const isPrimitive = (v: unknown): boolean =>
        v === null ||
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean";

    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
        if (typeof key !== "string") return false;
        if (isPrimitive(value)) continue;

        if (Array.isArray(value)) {
            if (!value.every(isPrimitive)) return false;
            continue;
        }

        if (typeof value === "object" && value !== null) {
            for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
                if (typeof nestedKey !== "string") return false;
                if (!isPrimitive(nestedValue) && !Array.isArray(nestedValue)) return false;
                if (Array.isArray(nestedValue) && !nestedValue.every(isPrimitive)) return false;
            }
            continue;
        }

        return false;
    }

    return true;
}

export const scheduleMetadataSchema = z
    .record(z.string(), z.any())
    .refine(
        validateMetadataObject,
        "Metadata must be an object with primitive values (or shallow arrays), max depth 2, and max size 32KB."
    )
    .nullable()
    .optional();

/**
 * Payload schema for creating a new ScheduleAppointment.
 *
 * Locked Invariants (Phase 1.8.1 §4.1, §6.3, §12):
 * - Target workOrderId and technicianId are required.
 * - scheduledStart and scheduledEnd are required.
 * - scheduledStart must be strictly earlier than scheduledEnd.
 * - Duration must be between 5 minutes and 14 days.
 * - .strict() rejects unexpected/unknown fields.
 */
export const createScheduleAppointmentSchema = z
    .object({
        workOrderId: z
            .string()
            .trim()
            .min(1, "Work order ID is required."),

        technicianId: z
            .string()
            .trim()
            .min(1, "Technician ID is required."),

        scheduledStart: z.coerce.date({
            error: "Scheduled start must be a valid date/time.",
        }),

        scheduledEnd: z.coerce.date({
            error: "Scheduled end must be a valid date/time.",
        }),

        timezone: z
            .string()
            .trim()
            .min(1, "Timezone must not be empty.")
            .max(100, "Timezone cannot exceed 100 characters.")
            .optional(),

        notes: z
            .string()
            .trim()
            .max(4000, "Notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        metadata: scheduleMetadataSchema,
    })
    .strict()
    .refine(
        (data) => data.scheduledStart.getTime() < data.scheduledEnd.getTime(),
        {
            message: "Scheduled start time must be strictly earlier than end time.",
            path: ["scheduledEnd"],
        }
    )
    .refine(
        (data) => {
            const duration = data.scheduledEnd.getTime() - data.scheduledStart.getTime();
            return duration >= MIN_DURATION_MS;
        },
        {
            message: "Appointment duration must be at least 5 minutes.",
            path: ["scheduledEnd"],
        }
    )
    .refine(
        (data) => {
            const duration = data.scheduledEnd.getTime() - data.scheduledStart.getTime();
            return duration <= MAX_DURATION_MS;
        },
        {
            message: "Appointment duration cannot exceed 14 days.",
            path: ["scheduledEnd"],
        }
    );

export type CreateScheduleAppointmentInput = z.infer<typeof createScheduleAppointmentSchema>;

/**
 * Payload schema for rescheduling an existing ScheduleAppointment.
 *
 * Locked Invariants (Phase 1.8.1 §5.4, §6.3, §15.2):
 * - New interval [scheduledStart, scheduledEnd] is required.
 * - Reason for rescheduling is mandatory (min 1 char).
 * - Enforces start < end, 5 min minimum, 14 days maximum.
 * - .strict() rejects unknown fields.
 */
export const rescheduleAppointmentSchema = z
    .object({
        scheduledStart: z.coerce.date({
            error: "Scheduled start must be a valid date/time.",
        }),

        scheduledEnd: z.coerce.date({
            error: "Scheduled end must be a valid date/time.",
        }),

        reason: z
            .string()
            .trim()
            .min(1, "Reschedule reason is required.")
            .max(2000, "Reschedule reason cannot exceed 2000 characters."),

        timezone: z
            .string()
            .trim()
            .min(1, "Timezone must not be empty.")
            .max(100, "Timezone cannot exceed 100 characters.")
            .optional(),
    })
    .strict()
    .refine(
        (data) => data.scheduledStart.getTime() < data.scheduledEnd.getTime(),
        {
            message: "Scheduled start time must be strictly earlier than end time.",
            path: ["scheduledEnd"],
        }
    )
    .refine(
        (data) => {
            const duration = data.scheduledEnd.getTime() - data.scheduledStart.getTime();
            return duration >= MIN_DURATION_MS;
        },
        {
            message: "Appointment duration must be at least 5 minutes.",
            path: ["scheduledEnd"],
        }
    )
    .refine(
        (data) => {
            const duration = data.scheduledEnd.getTime() - data.scheduledStart.getTime();
            return duration <= MAX_DURATION_MS;
        },
        {
            message: "Appointment duration cannot exceed 14 days.",
            path: ["scheduledEnd"],
        }
    );

export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

/**
 * Payload schema for cancelling a ScheduleAppointment.
 *
 * Locked Invariants (Phase 1.8.1 §5.4, §13):
 * - Mandatory cancellationReason (min 1 char).
 * - .strict() rejects unexpected fields.
 */
export const cancelAppointmentSchema = z
    .object({
        cancellationReason: z
            .string()
            .trim()
            .min(1, "Cancellation reason is required.")
            .max(2000, "Cancellation reason cannot exceed 2000 characters."),
    })
    .strict();

export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

/**
 * Payload schema for updating non-temporal metadata on a ScheduleAppointment.
 *
 * Locked Invariants (Phase 1.8.1 §15.7):
 * - Allows updating notes and metadata without changing time intervals.
 * - Time interval modifications must use rescheduleAppointmentSchema.
 * - .strict() rejects unknown fields.
 */
export const updateScheduleAppointmentSchema = z
    .object({
        notes: z
            .string()
            .trim()
            .max(4000, "Notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        metadata: scheduleMetadataSchema,
    })
    .strict();

export type UpdateScheduleAppointmentInput = z.infer<typeof updateScheduleAppointmentSchema>;

/**
 * Payload schema for dispatching an appointment to the field workforce.
 */
export const dispatchAppointmentSchema = z
    .object({
        notes: z
            .string()
            .trim()
            .max(2000, "Dispatch notes cannot exceed 2000 characters.")
            .nullable()
            .optional(),
    })
    .strict();

export type DispatchAppointmentInput = z.infer<typeof dispatchAppointmentSchema>;

/**
 * Payload schema for recalling/undispatching an appointment back to PENDING_DISPATCH.
 */
export const undispatchAppointmentSchema = z
    .object({
        reason: z
            .string()
            .trim()
            .max(2000, "Undispatch reason cannot exceed 2000 characters.")
            .nullable()
            .optional(),
    })
    .strict();

export type UndispatchAppointmentInput = z.infer<typeof undispatchAppointmentSchema>;

/**
 * Payload schema for technician acknowledging receipt of dispatch (Phase 1.9 entry point).
 */
export const acknowledgeDispatchSchema = z
    .object({
        notes: z
            .string()
            .trim()
            .max(2000, "Acknowledgment notes cannot exceed 2000 characters.")
            .nullable()
            .optional(),
    })
    .strict();

export type AcknowledgeDispatchInput = z.infer<typeof acknowledgeDispatchSchema>;

/**
 * Query parameter validation schema for listing appointments.
 *
 * Supports filtering by technician, work order, customer, location, status, date range,
 * full pagination, and sorted by allowlisted fields.
 */
export const listSchedulesQuerySchema = z
    .object({
        technicianId: z.string().trim().optional(),
        workOrderId: z.string().trim().optional(),
        customerId: z.string().trim().optional(),
        locationId: z.string().trim().optional(),
        status: scheduleStatusSchema.optional(),
        dispatchStatus: dispatchStatusSchema.optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        search: z.string().trim().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        sortBy: z
            .enum(SCHEDULE_SORT_FIELDS, {
                error: "sortBy must be one of: scheduledStart, scheduledEnd, createdAt, updatedAt, status.",
            })
            .default("scheduledStart"),
        sortOrder: z.enum(["asc", "desc"]).default("asc"),
    })
    .strict();

export type ListSchedulesQueryInput = z.infer<typeof listSchedulesQuerySchema>;

/**
 * Query parameter validation schema for technician calendar views.
 */
export const getTechnicianScheduleQuerySchema = z
    .object({
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        includeCancelled: z.coerce.boolean().default(false),
    })
    .strict()
    .refine((d) => d.startDate < d.endDate, {
        message: "startDate must be strictly earlier than endDate.",
        path: ["startDate"],
    });

export type GetTechnicianScheduleQueryInput = z.infer<typeof getTechnicianScheduleQuerySchema>;

/**
 * Query parameter validation schema for appointment audit history.
 */
export const getAppointmentHistoryQuerySchema = z
    .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .strict();

export type GetAppointmentHistoryQueryInput = z.infer<typeof getAppointmentHistoryQuerySchema>;

// Aliases for canonical service input naming
export type CreateScheduleInput = CreateScheduleAppointmentInput;
export type RescheduleScheduleInput = RescheduleAppointmentInput;
export type CancelScheduleInput = CancelAppointmentInput;
export type UpdateScheduleInput = UpdateScheduleAppointmentInput;
