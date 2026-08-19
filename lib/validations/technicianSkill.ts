import { z } from "zod";

export const SKILL_PROFICIENCIES = [
    "BEGINNER",
    "INTERMEDIATE",
    "ADVANCED",
    "EXPERT",
] as const;

export type SkillProficiencyType = (typeof SKILL_PROFICIENCIES)[number];

export const skillProficiencySchema = z.enum(SKILL_PROFICIENCIES, {
    error: "Proficiency must be one of: BEGINNER, INTERMEDIATE, ADVANCED, EXPERT.",
});

export const createTechnicianSkillSchema = z.object({
    proficiency: skillProficiencySchema.default("INTERMEDIATE"),

    yearsExperience: z
        .number()
        .int("Years of experience must be an integer.")
        .min(0, "Years of experience cannot be negative.")
        .max(100, "Years of experience must be less than 100.")
        .nullable()
        .optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type CreateTechnicianSkillInput = z.infer<typeof createTechnicianSkillSchema>;

export const updateTechnicianSkillSchema = z.object({
    proficiency: skillProficiencySchema.optional(),

    yearsExperience: z
        .number()
        .int("Years of experience must be an integer.")
        .min(0, "Years of experience cannot be negative.")
        .max(100, "Years of experience must be less than 100.")
        .nullable()
        .optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type UpdateTechnicianSkillInput = z.infer<typeof updateTechnicianSkillSchema>;
