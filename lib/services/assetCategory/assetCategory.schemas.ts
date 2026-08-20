import { z } from "zod";

export const ASSET_CATEGORY_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type AssetCategoryStatusType = (typeof ASSET_CATEGORY_STATUSES)[number];

export const assetCategoryStatusSchema = z.enum(ASSET_CATEGORY_STATUSES, {
    error: "Status must be 'ACTIVE' or 'INACTIVE'.",
});

export const ASSET_CATEGORY_SORT_FIELDS = [
    "name",
    "code",
    "sortOrder",
    "createdAt",
    "updatedAt",
] as const;

/**
 * Payload schema for creating a new AssetCategory.
 *
 * Locked Invariants (Phase 1.7.1 §6):
 * - name: required, 1-100 characters.
 * - code: optional, alphanumeric+hyphen, max 20 characters.
 * - sortOrder: integer, default 0.
 * - status: default ACTIVE.
 * - .strict() rejects unknown fields.
 */
export const createAssetCategorySchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, "Name must not be empty.")
            .max(100, "Name cannot exceed 100 characters."),

        code: z
            .string()
            .trim()
            .max(20, "Category code cannot exceed 20 characters.")
            .regex(
                /^[a-zA-Z0-9-]+$/,
                "Category code must contain only alphanumeric characters and hyphens."
            )
            .nullable()
            .optional(),

        description: z
            .string()
            .trim()
            .max(2000, "Description cannot exceed 2000 characters.")
            .nullable()
            .optional(),

        status: assetCategoryStatusSchema
            .default("ACTIVE"),

        sortOrder: z
            .number()
            .int("Sort order must be an integer.")
            .default(0),
    })
    .strict();

export const CreateAssetCategorySchema = createAssetCategorySchema;
export type CreateAssetCategorySchemaInput = z.infer<typeof createAssetCategorySchema>;

/**
 * Payload schema for updating an AssetCategory.
 *
 * Locked Invariants (Phase 1.7.1 §6 & §16):
 * - Immutable fields (id, workspaceId, createdAt) are forbidden.
 * - Partial update of name, code, description, status, sortOrder.
 * - .strict() rejects unknown fields.
 */
export const updateAssetCategorySchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, "Name must not be empty.")
            .max(100, "Name cannot exceed 100 characters.")
            .optional(),

        code: z
            .string()
            .trim()
            .max(20, "Category code cannot exceed 20 characters.")
            .regex(
                /^[a-zA-Z0-9-]+$/,
                "Category code must contain only alphanumeric characters and hyphens."
            )
            .nullable()
            .optional(),

        description: z
            .string()
            .trim()
            .max(2000, "Description cannot exceed 2000 characters.")
            .nullable()
            .optional(),

        status: assetCategoryStatusSchema
            .optional(),

        sortOrder: z
            .number()
            .int("Sort order must be an integer.")
            .optional(),
    })
    .strict();

export const UpdateAssetCategorySchema = updateAssetCategorySchema;
export type UpdateAssetCategorySchemaInput = z.infer<typeof updateAssetCategorySchema>;

/**
 * Query parameter schema for AssetCategory directory listing.
 *
 * Endpoint: GET /api/asset-categories
 */
export const getAssetCategoriesQuerySchema = z.object({
    status: z
        .enum(["ACTIVE", "INACTIVE", "ALL"], {
            error: "Status filter must be 'ACTIVE', 'INACTIVE', or 'ALL'.",
        })
        .default("ACTIVE"),

    search: z
        .string()
        .trim()
        .max(100, "Search query cannot exceed 100 characters.")
        .optional(),

    page: z
        .coerce.number()
        .int("Page must be an integer.")
        .min(1, "Page must be greater than or equal to 1.")
        .default(1),

    pageSize: z
        .coerce.number()
        .int("Page size must be an integer.")
        .min(1, "Page size must be greater than or equal to 1.")
        .max(100, "Page size cannot exceed 100.")
        .default(50),

    sortBy: z
        .enum(ASSET_CATEGORY_SORT_FIELDS, {
            error: `Sort field must be one of: ${ASSET_CATEGORY_SORT_FIELDS.join(", ")}.`,
        })
        .default("sortOrder"),

    sortOrder: z
        .enum(["asc", "desc"], {
            error: "Sort order must be 'asc' or 'desc'.",
        })
        .default("asc"),
});

export const GetAssetCategoriesQuerySchema = getAssetCategoriesQuerySchema;
export type GetAssetCategoriesQuerySchemaInput = z.infer<typeof getAssetCategoriesQuerySchema>;
