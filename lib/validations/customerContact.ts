import { z } from "zod";

export const createCustomerContactSchema = z.object({
    firstName: z
        .string()
        .trim()
        .min(1, "First name must not be empty.")
        .max(100, "First name must contain less than 100 characters."),

    lastName: z
        .string()
        .trim()
        .min(1, "Last name must not be empty.")
        .max(100, "Last name must contain less than 100 characters."),

    title: z
        .string()
        .trim()
        .max(150, "Title must contain less than 150 characters.")
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

    mobilePhone: z
        .string()
        .trim()
        .max(50, "Mobile phone number must contain less than 50 characters.")
        .nullable()
        .optional(),

    isPrimary: z.boolean().default(false).optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type CreateCustomerContactInput = z.infer<typeof createCustomerContactSchema>;

export const updateCustomerContactSchema = z.object({
    firstName: z
        .string()
        .trim()
        .min(1, "First name must not be empty.")
        .max(100, "First name must contain less than 100 characters.")
        .optional(),

    lastName: z
        .string()
        .trim()
        .min(1, "Last name must not be empty.")
        .max(100, "Last name must contain less than 100 characters.")
        .optional(),

    title: z
        .string()
        .trim()
        .max(150, "Title must contain less than 150 characters.")
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

    mobilePhone: z
        .string()
        .trim()
        .max(50, "Mobile phone number must contain less than 50 characters.")
        .nullable()
        .optional(),

    isPrimary: z.boolean().optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type UpdateCustomerContactInput = z.infer<typeof updateCustomerContactSchema>;

export const customerContactQuerySchema = z.object({
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
            "firstName",
            "lastName",
            "email",
            "createdAt",
            "updatedAt",
            "isPrimary",
        ])
        .optional()
        .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
});

export const getCustomerContactsQuerySchema = customerContactQuerySchema;

export type CustomerContactQueryInput = z.input<typeof customerContactQuerySchema>;
export type CustomerContactQueryOutput = z.output<typeof customerContactQuerySchema>;
export type GetCustomerContactsQueryInput = CustomerContactQueryInput;
export type GetCustomerContactsQueryOutput = CustomerContactQueryOutput;
