import { z } from "zod";

export const TECHNICIAN_EXCEPTION_TYPES = [
    "TIME_OFF",
    "VACATION",
    "SICK_LEAVE",
    "PERSONAL_LEAVE",
    "HOLIDAY",
    "TRAINING",
    "UNAVAILABLE",
    "OTHER",
] as const;

export type TechnicianExceptionType =
    (typeof TECHNICIAN_EXCEPTION_TYPES)[number];

export const TECHNICIAN_AVAILABILITY_EXCEPTION_STATUSES = [
    "ACTIVE",
    "CANCELLED",
] as const;

export type TechnicianAvailabilityExceptionStatusType =
    (typeof TECHNICIAN_AVAILABILITY_EXCEPTION_STATUSES)[number];

export const technicianExceptionTypeSchema = z.enum(TECHNICIAN_EXCEPTION_TYPES, {
    error: "Invalid exception type.",
});

export const technicianAvailabilityExceptionStatusSchema = z.enum(
    TECHNICIAN_AVAILABILITY_EXCEPTION_STATUSES,
    {
        error: "Status must be one of: ACTIVE, CANCELLED.",
    },
);

export const createTechnicianAvailabilityExceptionSchema = z
    .object({
        type: technicianExceptionTypeSchema.default("TIME_OFF"),
        title: z
            .string()
            .trim()
            .min(2, "Title must be at least 2 characters.")
            .max(150, "Title must contain less than 150 characters."),
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
        isAllDay: z.boolean().default(false),
        status: technicianAvailabilityExceptionStatusSchema.default("ACTIVE"),
        notes: z
            .string()
            .trim()
            .max(2000, "Notes must contain less than 2000 characters.")
            .nullable()
            .optional(),
    })
    .refine((data) => data.startsAt.getTime() < data.endsAt.getTime(), {
        message: "Start date/time must be earlier than end date/time.",
        path: ["startsAt"],
    });

export type CreateTechnicianAvailabilityExceptionInput = z.infer<
    typeof createTechnicianAvailabilityExceptionSchema
>;

export const updateTechnicianAvailabilityExceptionSchema = z
    .object({
        type: technicianExceptionTypeSchema.optional(),
        title: z
            .string()
            .trim()
            .min(2, "Title must be at least 2 characters.")
            .max(150, "Title must contain less than 150 characters.")
            .optional(),
        startsAt: z.coerce.date().optional(),
        endsAt: z.coerce.date().optional(),
        isAllDay: z.boolean().optional(),
        status: technicianAvailabilityExceptionStatusSchema.optional(),
        notes: z
            .string()
            .trim()
            .max(2000, "Notes must contain less than 2000 characters.")
            .nullable()
            .optional(),
    })
    .refine(
        (data) => {
            if (data.startsAt && data.endsAt) {
                return data.startsAt.getTime() < data.endsAt.getTime();
            }
            return true;
        },
        {
            message: "Start date/time must be earlier than end date/time.",
            path: ["startsAt"],
        },
    );

export type UpdateTechnicianAvailabilityExceptionInput = z.infer<
    typeof updateTechnicianAvailabilityExceptionSchema
>;

export const updateTechnicianAvailabilityExceptionStatusSchema = z.union([
    z.object({
        status: technicianAvailabilityExceptionStatusSchema,
    }),
    technicianAvailabilityExceptionStatusSchema.transform((status) => ({
        status,
    })),
]);

export type UpdateTechnicianAvailabilityExceptionStatusInput = z.infer<
    typeof updateTechnicianAvailabilityExceptionStatusSchema
>;
