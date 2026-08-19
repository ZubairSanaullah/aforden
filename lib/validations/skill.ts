import { z } from "zod";

export const SKILL_STATUSES = [
    "ACTIVE",
    "INACTIVE",
] as const;

export type SkillStatusType = (typeof SKILL_STATUSES)[number];

export const skillStatusSchema = z.enum(SKILL_STATUSES, {
    error: "Status must be one of: ACTIVE, INACTIVE.",
});

export const createSkillSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Skill name must be at least 2 characters.")
        .max(100, "Skill name must contain less than 100 characters."),

    description: z
        .string()
        .trim()
        .max(2000, "Description must contain less than 2000 characters.")
        .nullable()
        .optional(),

    status: skillStatusSchema.default("ACTIVE"),
});

export type CreateSkillInput = z.infer<typeof createSkillSchema>;

export const updateSkillSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Skill name must be at least 2 characters.")
        .max(100, "Skill name must contain less than 100 characters.")
        .optional(),

    description: z
        .string()
        .trim()
        .max(2000, "Description must contain less than 2000 characters.")
        .nullable()
        .optional(),

    status: skillStatusSchema.optional(),
});

export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;

export const updateSkillStatusSchema = z.union([
    z.object({
        status: skillStatusSchema,
    }),
    skillStatusSchema.transform((status) => ({ status })),
]);

export type UpdateSkillStatusInput = z.infer<typeof updateSkillStatusSchema>;
