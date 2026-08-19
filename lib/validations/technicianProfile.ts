import { z } from "zod";

export const createTechnicianProfileSchema = z.object({
    licenseNumber: z
        .string()
        .trim()
        .max(100, "License number must contain less than 100 characters.")
        .nullable()
        .optional(),

    yearsExperience: z
        .number()
        .int("Years of experience must be an integer.")
        .min(0, "Years of experience cannot be negative.")
        .max(100, "Years of experience must be less than 100.")
        .nullable()
        .optional(),

    emergencyContact: z
        .string()
        .trim()
        .max(100, "Emergency contact must contain less than 100 characters.")
        .nullable()
        .optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type CreateTechnicianProfileInput = z.infer<typeof createTechnicianProfileSchema>;

export const updateTechnicianProfileSchema = z.object({
    licenseNumber: z
        .string()
        .trim()
        .max(100, "License number must contain less than 100 characters.")
        .nullable()
        .optional(),

    yearsExperience: z
        .number()
        .int("Years of experience must be an integer.")
        .min(0, "Years of experience cannot be negative.")
        .max(100, "Years of experience must be less than 100.")
        .nullable()
        .optional(),

    emergencyContact: z
        .string()
        .trim()
        .max(100, "Emergency contact must contain less than 100 characters.")
        .nullable()
        .optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type UpdateTechnicianProfileInput = z.infer<typeof updateTechnicianProfileSchema>;
