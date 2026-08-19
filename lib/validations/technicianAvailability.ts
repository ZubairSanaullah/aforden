import { z } from "zod";

export const AVAILABILITY_DAYS = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
] as const;

export type AvailabilityDayType = (typeof AVAILABILITY_DAYS)[number];

export const TECHNICIAN_AVAILABILITY_STATUSES = [
    "ACTIVE",
    "INACTIVE",
] as const;

export type TechnicianAvailabilityStatusType = (typeof TECHNICIAN_AVAILABILITY_STATUSES)[number];

export const availabilityDaySchema = z.enum(AVAILABILITY_DAYS, {
    error: "Invalid day of week.",
});

export const technicianAvailabilityStatusSchema = z.enum(
    TECHNICIAN_AVAILABILITY_STATUSES,
    {
        error: "Status must be one of: ACTIVE, INACTIVE.",
    },
);

export const timeStringSchema = z
    .string()
    .regex(
        /^([01]\d|2[0-3]):([0-5]\d)$/,
        "Time must be in 24-hour HH:mm format (00:00 to 23:59).",
    );

export function parseTimeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + minutes;
}

export function isTimeEarlier(start: string, end: string): boolean {
    return parseTimeToMinutes(start) < parseTimeToMinutes(end);
}

export const createTechnicianAvailabilitySchema = z
    .object({
        dayOfWeek: availabilityDaySchema,
        startTime: timeStringSchema,
        endTime: timeStringSchema,
        status: technicianAvailabilityStatusSchema.default("ACTIVE"),
        notes: z
            .string()
            .trim()
            .max(2000, "Notes must contain less than 2000 characters.")
            .nullable()
            .optional(),
    })
    .refine((data) => isTimeEarlier(data.startTime, data.endTime), {
        message: "Start time must be earlier than end time.",
        path: ["startTime"],
    });

export type CreateTechnicianAvailabilityInput = z.infer<
    typeof createTechnicianAvailabilitySchema
>;

export const updateTechnicianAvailabilitySchema = z
    .object({
        dayOfWeek: availabilityDaySchema.optional(),
        startTime: timeStringSchema.optional(),
        endTime: timeStringSchema.optional(),
        status: technicianAvailabilityStatusSchema.optional(),
        notes: z
            .string()
            .trim()
            .max(2000, "Notes must contain less than 2000 characters.")
            .nullable()
            .optional(),
    })
    .refine(
        (data) => {
            if (data.startTime && data.endTime) {
                return isTimeEarlier(data.startTime, data.endTime);
            }
            return true;
        },
        {
            message: "Start time must be earlier than end time.",
            path: ["startTime"],
        },
    );

export type UpdateTechnicianAvailabilityInput = z.infer<
    typeof updateTechnicianAvailabilitySchema
>;

export const updateTechnicianAvailabilityStatusSchema = z.union([
    z.object({
        status: technicianAvailabilityStatusSchema,
    }),
    technicianAvailabilityStatusSchema.transform((status) => ({ status })),
]);

export type UpdateTechnicianAvailabilityStatusInput = z.infer<
    typeof updateTechnicianAvailabilityStatusSchema
>;
