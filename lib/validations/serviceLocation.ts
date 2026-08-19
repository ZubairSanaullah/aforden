import { z } from "zod";

export const createServiceLocationSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Name must not be empty.")
        .max(150, "Name must contain less than 150 characters."),

    addressLine1: z
        .string()
        .trim()
        .min(1, "Address line 1 must not be empty.")
        .max(255, "Address line 1 must contain less than 255 characters."),

    addressLine2: z
        .string()
        .trim()
        .max(255, "Address line 2 must contain less than 255 characters.")
        .nullable()
        .optional(),

    city: z
        .string()
        .trim()
        .min(1, "City must not be empty.")
        .max(100, "City must contain less than 100 characters."),

    state: z
        .string()
        .trim()
        .max(100, "State must contain less than 100 characters.")
        .nullable()
        .optional(),

    postalCode: z
        .string()
        .trim()
        .max(50, "Postal code must contain less than 50 characters.")
        .nullable()
        .optional(),

    country: z
        .string()
        .trim()
        .min(1, "Country must not be empty.")
        .max(100, "Country must contain less than 100 characters."),

    latitude: z
        .number()
        .min(-90, "Latitude must be between -90 and 90.")
        .max(90, "Latitude must be between -90 and 90.")
        .nullable()
        .optional(),

    longitude: z
        .number()
        .min(-180, "Longitude must be between -180 and 180.")
        .max(180, "Longitude must be between -180 and 180.")
        .nullable()
        .optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),

    isPrimary: z.boolean().default(false).optional(),
});

export type CreateServiceLocationInput = z.infer<typeof createServiceLocationSchema>;

export const updateServiceLocationSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Name must not be empty.")
        .max(150, "Name must contain less than 150 characters.")
        .optional(),

    addressLine1: z
        .string()
        .trim()
        .min(1, "Address line 1 must not be empty.")
        .max(255, "Address line 1 must contain less than 255 characters.")
        .optional(),

    addressLine2: z
        .string()
        .trim()
        .max(255, "Address line 2 must contain less than 255 characters.")
        .nullable()
        .optional(),

    city: z
        .string()
        .trim()
        .min(1, "City must not be empty.")
        .max(100, "City must contain less than 100 characters.")
        .optional(),

    state: z
        .string()
        .trim()
        .max(100, "State must contain less than 100 characters.")
        .nullable()
        .optional(),

    postalCode: z
        .string()
        .trim()
        .max(50, "Postal code must contain less than 50 characters.")
        .nullable()
        .optional(),

    country: z
        .string()
        .trim()
        .min(1, "Country must not be empty.")
        .max(100, "Country must contain less than 100 characters.")
        .optional(),

    latitude: z
        .number()
        .min(-90, "Latitude must be between -90 and 90.")
        .max(90, "Latitude must be between -90 and 90.")
        .nullable()
        .optional(),

    longitude: z
        .number()
        .min(-180, "Longitude must be between -180 and 180.")
        .max(180, "Longitude must be between -180 and 180.")
        .nullable()
        .optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),

    isPrimary: z.boolean().optional(),
});

export type UpdateServiceLocationInput = z.infer<typeof updateServiceLocationSchema>;

export const serviceLocationQuerySchema = z.object({
    search: z
        .string()
        .trim()
        .max(100, "Search query must contain less than 100 characters.")
        .optional(),

    isPrimary: z
        .union([
            z.boolean(),
            z.enum(["true", "false"]).transform((v) => v === "true"),
        ])
        .optional(),

    page: z.coerce.number().int().min(1, "Page must be at least 1.").default(1),

    pageSize: z.coerce
        .number()
        .int()
        .min(1, "Page size must be at least 1.")
        .max(100, "Page size must not exceed 100.")
        .default(20),

    sortBy: z
        .enum([
            "name",
            "city",
            "state",
            "postalCode",
            "country",
            "createdAt",
            "updatedAt",
            "isPrimary",
        ])
        .optional()
        .default("createdAt"),

    sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
});

export const getServiceLocationsQuerySchema = serviceLocationQuerySchema;

export type ServiceLocationQueryInput = z.input<typeof serviceLocationQuerySchema>;
export type ServiceLocationQueryOutput = z.output<typeof serviceLocationQuerySchema>;
export type GetServiceLocationsQueryInput = ServiceLocationQueryInput;
export type GetServiceLocationsQueryOutput = ServiceLocationQueryOutput;
