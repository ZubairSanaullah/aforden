import { z } from "zod";

export const PUBLIC_ASSET_STATUSES = [
    "OPERATIONAL",
    "DEGRADED",
    "OUT_OF_SERVICE",
    "IN_STORAGE",
    "DECOMMISSIONED",
    "RETIRED",
] as const;

export const publicAssetStatusSchema = z.enum(PUBLIC_ASSET_STATUSES, {
    error: "Status must be one of: OPERATIONAL, DEGRADED, OUT_OF_SERVICE, IN_STORAGE, DECOMMISSIONED, RETIRED.",
});

export const publicAssetTagSchema = z
    .string()
    .trim()
    .min(1, "Tag must not be empty.")
    .max(30, "Tag cannot exceed 30 characters.")
    .refine(
        (tag) => /^[a-z0-9-]+$/.test(tag),
        "Tag must contain only lowercase alphanumeric characters and hyphens.",
    );

export const publicAssetTagsArraySchema = z
    .array(publicAssetTagSchema)
    .max(20, "An asset cannot have more than 20 tags.")
    .default([]);

export const createPublicAssetSchema = z.object({
    name: z
        .string({
            error: "Asset name is required.",
        })
        .trim()
        .min(1, "Asset name must not be empty.")
        .max(200, "Asset name must contain less than 200 characters."),

    assetNumber: z
        .string()
        .trim()
        .min(1, "Asset number must not be empty.")
        .max(50, "Asset number cannot exceed 50 characters.")
        .optional(),

    customerId: z
        .string()
        .trim()
        .min(1, "Customer ID must not be empty.")
        .nullable()
        .optional(),

    locationId: z
        .string()
        .trim()
        .min(1, "Location ID must not be empty.")
        .nullable()
        .optional(),

    categoryId: z
        .string()
        .trim()
        .min(1, "Category ID must not be empty.")
        .nullable()
        .optional(),

    manufacturer: z
        .string()
        .trim()
        .max(100, "Manufacturer cannot exceed 100 characters.")
        .nullable()
        .optional(),

    modelNumber: z
        .string()
        .trim()
        .max(100, "Model number cannot exceed 100 characters.")
        .nullable()
        .optional(),

    serialNumber: z
        .string()
        .trim()
        .max(100, "Serial number cannot exceed 100 characters.")
        .nullable()
        .optional(),

    status: publicAssetStatusSchema.default("OPERATIONAL").optional(),

    subLocationNotes: z
        .string()
        .trim()
        .max(2000, "Sub-location notes cannot exceed 2000 characters.")
        .nullable()
        .optional(),

    installationDate: z.coerce.date().nullable().optional(),
    warrantyExpiresAt: z.coerce.date().nullable().optional(),
    purchaseDate: z.coerce.date().nullable().optional(),

    tags: publicAssetTagsArraySchema.optional(),
});

export type CreatePublicAssetInput = z.infer<typeof createPublicAssetSchema>;

export const updatePublicAssetSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Asset name must not be empty.")
        .max(200, "Asset name must contain less than 200 characters.")
        .optional(),

    assetNumber: z
        .string()
        .trim()
        .min(1, "Asset number must not be empty.")
        .max(50, "Asset number cannot exceed 50 characters.")
        .optional(),

    categoryId: z
        .string()
        .trim()
        .min(1, "Category ID must not be empty.")
        .nullable()
        .optional(),

    manufacturer: z
        .string()
        .trim()
        .max(100, "Manufacturer cannot exceed 100 characters.")
        .nullable()
        .optional(),

    modelNumber: z
        .string()
        .trim()
        .max(100, "Model number cannot exceed 100 characters.")
        .nullable()
        .optional(),

    serialNumber: z
        .string()
        .trim()
        .max(100, "Serial number cannot exceed 100 characters.")
        .nullable()
        .optional(),

    subLocationNotes: z
        .string()
        .trim()
        .max(2000, "Sub-location notes cannot exceed 2000 characters.")
        .nullable()
        .optional(),

    installationDate: z.coerce.date().nullable().optional(),
    warrantyExpiresAt: z.coerce.date().nullable().optional(),
    purchaseDate: z.coerce.date().nullable().optional(),

    tags: publicAssetTagsArraySchema.optional(),
});

export type UpdatePublicAssetInput = z.infer<typeof updatePublicAssetSchema>;

export const listPublicAssetsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50).optional(),
    status: z.string().optional(),
    customerId: z.string().optional(),
    locationId: z.string().optional(),
    categoryId: z.string().optional(),
    manufacturer: z.string().optional(),
    sort: z.string().optional(),
    search: z.string().optional(),
});

export type ListPublicAssetsQueryInput = z.infer<typeof listPublicAssetsQuerySchema>;
