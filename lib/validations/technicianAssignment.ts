import { z } from "zod";

export const assignmentWorkTypeSchema = z.enum(["WORK"]);

export const technicianAssignmentStatusSchema = z.enum([
    "ASSIGNED",
    "CANCELLED",
    "COMPLETED",
]);

export const createTechnicianAssignmentSchema = z
    .object({
        technicianProfileId: z
            .string()
            .trim()
            .min(1, "Technician profile ID is required."),
        workType: assignmentWorkTypeSchema.default("WORK"),
        workReferenceId: z
            .string()
            .trim()
            .min(1, "Work reference ID is required."),
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
        serviceAreaId: z.string().trim().min(1).optional(),
        requiredSkillIds: z
            .array(z.string().trim().min(1))
            .optional()
            .default([]),
        notes: z.string().max(2000).nullable().optional(),
    })
    .refine((data) => data.startsAt.getTime() < data.endsAt.getTime(), {
        message: "Start date/time must be earlier than end date/time.",
        path: ["startsAt"],
    });

export type CreateTechnicianAssignmentInput = z.input<
    typeof createTechnicianAssignmentSchema
>;

export const updateTechnicianAssignmentSchema = z
    .object({
        startsAt: z.coerce.date().optional(),
        endsAt: z.coerce.date().optional(),
        serviceAreaId: z.string().trim().min(1).optional(),
        requiredSkillIds: z
            .array(z.string().trim().min(1))
            .optional(),
        notes: z.string().max(2000).nullable().optional(),
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

export type UpdateTechnicianAssignmentInput = z.input<
    typeof updateTechnicianAssignmentSchema
>;

export const updateTechnicianAssignmentStatusSchema = z.object({
    status: technicianAssignmentStatusSchema,
    cancellationReason: z
        .string()
        .trim()
        .min(1, "Cancellation reason cannot be empty if provided.")
        .max(2000, "Cancellation reason cannot exceed 2000 characters.")
        .nullable()
        .optional(),
});

export type UpdateTechnicianAssignmentStatusInput = z.input<
    typeof updateTechnicianAssignmentStatusSchema
>;

export const cancelTechnicianAssignmentSchema = z.object({
    cancellationReason: z
        .string()
        .trim()
        .min(1, "Cancellation reason cannot be empty if provided.")
        .max(2000, "Cancellation reason cannot exceed 2000 characters.")
        .nullable()
        .optional(),
});

export type CancelTechnicianAssignmentInput = z.input<
    typeof cancelTechnicianAssignmentSchema
>;
