import { z } from "zod";

export const ORGANIZATION_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export type OrganizationStatusType = (typeof ORGANIZATION_STATUSES)[number];

const urlSchema = z
    .string()
    .trim()
    .url("Please enter a valid URL.")
    .refine(
        (val) => /^https?:\/\//i.test(val),
        "URL must start with http:// or https://",
    )
    .max(500, "URL must contain less than 500 characters.");

export const updateOrganizationSchema = z.object({
    businessName: z
        .string()
        .trim()
        .min(2, "Business name must contain at least 2 characters.")
        .max(100, "Business name must contain less than 100 characters.")
        .optional(),

    legalName: z
        .string()
        .trim()
        .max(150, "Legal name must contain less than 150 characters.")
        .nullable()
        .optional(),

    logoUrl: urlSchema
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

    description: z
        .string()
        .trim()
        .max(2000, "Description must contain less than 2000 characters.")
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

    country: z
        .string()
        .trim()
        .max(100, "Country must contain less than 100 characters.")
        .nullable()
        .optional(),

    postalCode: z
        .string()
        .trim()
        .max(50, "Postal code must contain less than 50 characters.")
        .nullable()
        .optional(),

    taxId: z
        .string()
        .trim()
        .max(100, "Tax ID must contain less than 100 characters.")
        .nullable()
        .optional(),

    registrationNumber: z
        .string()
        .trim()
        .max(100, "Registration number must contain less than 100 characters.")
        .nullable()
        .optional(),

    status: z
        .enum(ORGANIZATION_STATUSES, {
            error: "Status must be either ACTIVE or INACTIVE.",
        })
        .optional(),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
