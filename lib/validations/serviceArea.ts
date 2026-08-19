import { z } from "zod";

export const SERVICE_AREA_STATUSES = [
    "ACTIVE",
    "INACTIVE",
] as const;

export type ServiceAreaStatusType = (typeof SERVICE_AREA_STATUSES)[number];

export const serviceAreaStatusSchema = z.enum(SERVICE_AREA_STATUSES, {
    error: "Status must be one of: ACTIVE, INACTIVE.",
});

export const createServiceAreaSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Service area name must be at least 2 characters.")
        .max(100, "Service area name must contain less than 100 characters."),

    description: z
        .string()
        .trim()
        .max(2000, "Description must contain less than 2000 characters.")
        .nullable()
        .optional(),

    status: serviceAreaStatusSchema.default("ACTIVE"),
});

export type CreateServiceAreaInput = z.infer<typeof createServiceAreaSchema>;

export const updateServiceAreaSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Service area name must be at least 2 characters.")
        .max(100, "Service area name must contain less than 100 characters.")
        .optional(),

    description: z
        .string()
        .trim()
        .max(2000, "Description must contain less than 2000 characters.")
        .nullable()
        .optional(),

    status: serviceAreaStatusSchema.optional(),
});

export type UpdateServiceAreaInput = z.infer<typeof updateServiceAreaSchema>;

export const updateServiceAreaStatusSchema = z.union([
    z.object({
        status: serviceAreaStatusSchema,
    }),
    serviceAreaStatusSchema.transform((status) => ({ status })),
]);

export type UpdateServiceAreaStatusInput = z.infer<typeof updateServiceAreaStatusSchema>;
