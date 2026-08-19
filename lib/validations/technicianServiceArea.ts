import { z } from "zod";

export const createTechnicianServiceAreaSchema = z.object({
    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type CreateTechnicianServiceAreaInput = z.infer<typeof createTechnicianServiceAreaSchema>;

export const updateTechnicianServiceAreaSchema = z.object({
    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type UpdateTechnicianServiceAreaInput = z.infer<typeof updateTechnicianServiceAreaSchema>;
