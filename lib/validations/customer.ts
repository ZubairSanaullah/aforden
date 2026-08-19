import { z } from "zod";

export const CUSTOMER_STATUSES = [
    "ACTIVE",
    "INACTIVE",
] as const;

export type CustomerStatusType = (typeof CUSTOMER_STATUSES)[number];

export const customerStatusSchema = z.enum(CUSTOMER_STATUSES, {
    error: "Status must be one of: ACTIVE, INACTIVE.",
});

const urlSchema = z
    .string()
    .trim()
    .url("Please enter a valid URL.")
    .refine(
        (val) => /^https?:\/\//i.test(val),
        "URL must start with http:// or https://",
    )
    .max(500, "URL must contain less than 500 characters.");

export const createCustomerSchema = z.object({
    name: z
        .string()
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

    status: customerStatusSchema.default("ACTIVE"),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z.object({
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

    status: customerStatusSchema.optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const updateCustomerStatusSchema = z.union([
    z.object({
        status: customerStatusSchema,
    }),
    customerStatusSchema.transform((status) => ({ status })),
]);

export type UpdateCustomerStatusInput = z.infer<typeof updateCustomerStatusSchema>;
export type CustomerStatusInput = UpdateCustomerStatusInput;

export const customerQuerySchema = z.object({
    search: z
        .string()
        .trim()
        .max(100, "Search query must contain less than 100 characters.")
        .optional(),
    status: customerStatusSchema.optional(),
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
            "customerNumber",
            "createdAt",
            "updatedAt",
            "city",
            "status",
        ])
        .optional()
        .default("name"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
});

export const getCustomersQuerySchema = customerQuerySchema;

export type CustomerQueryInput = z.input<typeof customerQuerySchema>;
export type CustomerQueryOutput = z.output<typeof customerQuerySchema>;
export type GetCustomersQueryInput = CustomerQueryInput;
export type GetCustomersQueryOutput = CustomerQueryOutput;
