import { z } from "zod";

export const SERVICE_CATALOG_STATUSES = [
    "ACTIVE",
    "INACTIVE",
] as const;

export type ServiceCatalogStatusType = (typeof SERVICE_CATALOG_STATUSES)[number];

export const serviceCatalogStatusSchema = z.enum(SERVICE_CATALOG_STATUSES, {
    error: "Status must be one of: ACTIVE, INACTIVE.",
});

export const createServiceCatalogSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Catalog name must not be empty.")
        .max(100, "Catalog name must contain less than 100 characters."),

    description: z
        .string()
        .trim()
        .max(2000, "Description must contain less than 2000 characters.")
        .nullable()
        .optional(),

    sortOrder: z
        .number()
        .int("Sort order must be an integer.")
        .default(0)
        .optional(),
});

export type CreateServiceCatalogInput = z.infer<typeof createServiceCatalogSchema>;

export const updateServiceCatalogSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Catalog name must not be empty.")
        .max(100, "Catalog name must contain less than 100 characters.")
        .optional(),

    description: z
        .string()
        .trim()
        .max(2000, "Description must contain less than 2000 characters.")
        .nullable()
        .optional(),

    sortOrder: z
        .number()
        .int("Sort order must be an integer.")
        .optional(),
});

export type UpdateServiceCatalogInput = z.infer<typeof updateServiceCatalogSchema>;

export const updateServiceCatalogStatusSchema = z.union([
    z.object({
        status: serviceCatalogStatusSchema,
    }),
    serviceCatalogStatusSchema.transform((status) => ({ status })),
]);

export const changeServiceCatalogStatusSchema = updateServiceCatalogStatusSchema;

export type UpdateServiceCatalogStatusInput = z.infer<typeof updateServiceCatalogStatusSchema>;
export type ChangeServiceCatalogStatusInput = UpdateServiceCatalogStatusInput;

export const serviceCatalogQuerySchema = z.object({
    search: z
        .string()
        .trim()
        .max(100, "Search query must contain less than 100 characters.")
        .optional(),

    status: serviceCatalogStatusSchema.optional(),

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
            "status",
            "sortOrder",
            "createdAt",
            "updatedAt",
        ])
        .optional()
        .default("sortOrder"),

    sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
});

export const getServiceCatalogsQuerySchema = serviceCatalogQuerySchema;

export type ServiceCatalogQueryInput = z.input<typeof serviceCatalogQuerySchema>;
export type ServiceCatalogQueryOutput = z.output<typeof serviceCatalogQuerySchema>;
export type GetServiceCatalogsQueryInput = ServiceCatalogQueryInput;
export type GetServiceCatalogsQueryOutput = ServiceCatalogQueryOutput;
