import { z } from "zod";

const urlSchema = z
    .string()
    .trim()
    .url("Please enter a valid URL.")
    .refine(
        (val) => /^https?:\/\//i.test(val),
        "URL must start with http:// or https://",
    )
    .max(500, "URL must contain less than 500 characters.");

export const createPublicCustomerSchema = z.object({
    name: z
        .string({
            error: "Customer name is required.",
        })
        .trim()
        .min(1, "Customer name must not be empty.")
        .max(150, "Customer name must contain less than 150 characters."),

    customerNumber: z
        .string()
        .trim()
        .min(1, "Customer number must not be empty.")
        .max(50, "Customer number must contain less than 50 characters.")
        .nullable()
        .optional(),

    email: z
        .string()
        .trim()
        .email("Please enter a valid email address.")
        .max(100, "Email must contain less than 100 characters.")
        .transform((value) => value.toLowerCase())
        .nullable()
        .optional(),

    phone: z
        .string()
        .trim()
        .max(50, "Phone number must contain less than 50 characters.")
        .nullable()
        .optional(),

    website: urlSchema
        .nullable()
        .optional(),

    addressLine1: z
        .string()
        .trim()
        .max(100, "Address line 1 must contain less than 100 characters.")
        .nullable()
        .optional(),

    addressLine2: z
        .string()
        .trim()
        .max(100, "Address line 2 must contain less than 100 characters.")
        .nullable()
        .optional(),

    city: z
        .string()
        .trim()
        .max(100, "City must contain less than 100 characters.")
        .nullable()
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
        .max(100, "Country must contain less than 100 characters.")
        .nullable()
        .optional(),
});

export type CreatePublicCustomerInput = z.infer<typeof createPublicCustomerSchema>;

export const updatePublicCustomerSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Customer name must not be empty.")
        .max(150, "Customer name must contain less than 150 characters.")
        .optional(),

    customerNumber: z
        .string()
        .trim()
        .min(1, "Customer number must not be empty.")
        .max(50, "Customer number must contain less than 50 characters.")
        .optional(),

    email: z
        .string()
        .trim()
        .email("Please enter a valid email address.")
        .max(100, "Email must contain less than 100 characters.")
        .transform((value) => value.toLowerCase())
        .nullable()
        .optional(),

    phone: z
        .string()
        .trim()
        .max(50, "Phone number must contain less than 50 characters.")
        .nullable()
        .optional(),

    website: urlSchema
        .nullable()
        .optional(),

    addressLine1: z
        .string()
        .trim()
        .max(100, "Address line 1 must contain less than 100 characters.")
        .nullable()
        .optional(),

    addressLine2: z
        .string()
        .trim()
        .max(100, "Address line 2 must contain less than 100 characters.")
        .nullable()
        .optional(),

    city: z
        .string()
        .trim()
        .max(100, "City must contain less than 100 characters.")
        .nullable()
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
        .max(100, "Country must contain less than 100 characters.")
        .nullable()
        .optional(),
});

export type UpdatePublicCustomerInput = z.infer<typeof updatePublicCustomerSchema>;

export const createPublicServiceLocationSchema = z.object({
    name: z
        .string({
            error: "Location name is required.",
        })
        .trim()
        .min(1, "Location name must not be empty.")
        .max(150, "Location name must contain less than 150 characters."),

    addressLine1: z
        .string({
            error: "Address line 1 is required.",
        })
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
        .string({
            error: "City is required.",
        })
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
        .string({
            error: "Country is required.",
        })
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

    isPrimary: z.boolean().default(false).optional(),
});

export type CreatePublicServiceLocationInput = z.infer<typeof createPublicServiceLocationSchema>;

export const updatePublicServiceLocationSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Location name must not be empty.")
        .max(150, "Location name must contain less than 150 characters.")
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

    isPrimary: z.boolean().optional(),
});

export type UpdatePublicServiceLocationInput = z.infer<typeof updatePublicServiceLocationSchema>;
