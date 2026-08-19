import { z } from "zod";

export const technicianWorkEligibilityInputSchema = z
    .object({
        requiredSkillIds: z
            .array(z.string().trim().min(1))
            .optional()
            .default([]),
        serviceAreaId: z.string().trim().min(1, "Service Area ID is required."),
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
    })
    .refine((data) => data.startsAt.getTime() < data.endsAt.getTime(), {
        message: "Start date/time must be earlier than end date/time.",
        path: ["startsAt"],
    });

export type TechnicianWorkEligibilityInput = z.infer<
    typeof technicianWorkEligibilityInputSchema
>;

export const getEligibleTechniciansQuerySchema = z
    .object({
        requiredSkillIds: z
            .array(z.string().trim().min(1))
            .optional()
            .default([]),
        serviceAreaId: z.string().trim().min(1, "Service Area ID is required."),
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .default(20),
    })
    .refine((data) => data.startsAt.getTime() < data.endsAt.getTime(), {
        message: "Start date/time must be earlier than end date/time.",
        path: ["startsAt"],
    });

export type GetEligibleTechniciansQueryInput = z.infer<
    typeof getEligibleTechniciansQuerySchema
>;
