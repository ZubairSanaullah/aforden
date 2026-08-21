import { z } from "zod";
import {
    isReasonRequiredForTransition,
    REASON_REQUIRED_TARGET_STATUSES,
} from "./assetStatusTransitions";

export const ASSET_STATUSES = [
    "OPERATIONAL",
    "DEGRADED",
    "OUT_OF_SERVICE",
    "IN_STORAGE",
    "DECOMMISSIONED",
    "RETIRED",
] as const;

export type AssetStatusType = (typeof ASSET_STATUSES)[number];

export const assetStatusSchema = z.enum(ASSET_STATUSES, {
    error: "Status must be one of: OPERATIONAL, DEGRADED, OUT_OF_SERVICE, IN_STORAGE, DECOMMISSIONED, RETIRED.",
});

export const ASSET_SORT_FIELDS = [
    "createdAt",
    "updatedAt",
    "name",
    "assetNumber",
    "serialNumber",
    "status",
    "manufacturer",
] as const;

export type AssetSortFieldType = (typeof ASSET_SORT_FIELDS)[number];

/**
 * Validates individual tags per Phase 1.7.1 Section 7.1:
 * - Lowercase alphanumeric + hyphen strings
 * - 1 to 30 characters
 */
export const assetTagSchema = z
    .string()
    .trim()
    .min(1, "Tag must not be empty.")
    .max(30, "Tag cannot exceed 30 characters.")
    .refine(
        (tag) => /^[a-z0-9-]+$/.test(tag),
        "Tag must contain only lowercase alphanumeric characters and hyphens."
    );

/**
 * Validates the tag list (max 20 tags per asset).
 */
export const assetTagsArraySchema = z
    .array(assetTagSchema)
    .max(20, "An asset cannot have more than 20 tags.")
    .default([]);

/**
 * Helper to validate metadata structure per Phase 1.7.1 Section 7.2:
 * - Object with primitive values or shallow arrays of primitives
 * - Maximum depth of 2
 * - Maximum JSON serialized size 32KB (32,768 bytes)
 */
function validateMetadataObject(val: unknown): boolean {
    if (val === null || val === undefined) return true;
    if (typeof val !== "object" || Array.isArray(val)) return false;

    // Check size limit (32KB)
    try {
        const serialized = JSON.stringify(val);
        if (serialized.length > 32768) return false;
    } catch {
        return false;
    }

    // Check depth and primitive content
    const isPrimitive = (v: unknown): boolean =>
        v === null ||
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean";

    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
        if (typeof key !== "string") return false;

        if (isPrimitive(value)) continue;

        if (Array.isArray(value)) {
            // Shallow array of primitives
            if (!value.every(isPrimitive)) return false;
            continue;
        }

        if (typeof value === "object" && value !== null) {
            // Depth 2 object: must only contain primitives
            for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
                if (typeof nestedKey !== "string") return false;
                if (!isPrimitive(nestedValue) && !Array.isArray(nestedValue)) return false;
                if (Array.isArray(nestedValue) && !nestedValue.every(isPrimitive)) return false;
            }
            continue;
        }

        return false;
    }

    return true;
}

export const assetMetadataSchema = z
    .record(z.string(), z.any())
    .refine(
        validateMetadataObject,
        "Metadata must be an object with primitive values (or shallow arrays), max depth 2, and max size 32KB."
    )
    .nullable()
    .optional();

/**
 * Payload schema for creating a new Asset.
 *
 * Locked Invariants (Phase 1.7.1 §16):
 * - Name is required (1-200 chars).
 * - assetNumber is optional in payload (auto-generated if omitted), 1-50 chars.
 * - customerId & locationId are nullable (supports depot inventory).
 * - tags: max 20 tags, 1-30 chars each, lowercase alphanumeric+hyphen.
 * - metadata: validated hybrid JSON.
 * - .strict() rejects unknown fields.
 */
export const createAssetSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, "Name must not be empty.")
            .max(200, "Name must contain less than 200 characters."),

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

        status: assetStatusSchema
            .default("OPERATIONAL"),

        subLocationNotes: z
            .string()
            .trim()
            .max(2000, "Sub-location notes cannot exceed 2000 characters.")
            .nullable()
            .optional(),

        installationDate: z
            .coerce.date()
            .nullable()
            .optional(),

        warrantyExpiresAt: z
            .coerce.date()
            .nullable()
            .optional(),

        purchaseDate: z
            .coerce.date()
            .nullable()
            .optional(),

        purchaseCost: z
            .union([
                z.number().min(0, "Purchase cost must be non-negative."),
                z.string().regex(/^\d+(\.\d{1,2})?$/, "Purchase cost must be a valid currency amount."),
            ])
            .nullable()
            .optional(),

        notes: z
            .string()
            .trim()
            .max(4000, "Notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        tags: assetTagsArraySchema
            .optional(),

        metadata: assetMetadataSchema,
    })
    .strict();

export const CreateAssetSchema = createAssetSchema;
export type CreateAssetSchemaInput = z.infer<typeof createAssetSchema>;

/**
 * Payload schema for updating mutable Asset metadata and technical specifications.
 *
 * Locked Invariants (Phase 1.7.1 §16):
 * - Only standard mutable fields are accepted.
 * - Immutable, transfer, and lifecycle status fields are strictly forbidden.
 * - .strict() rejects unknown fields.
 */
export const updateAssetSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, "Name must not be empty.")
            .max(200, "Name must contain less than 200 characters.")
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

        installationDate: z
            .coerce.date()
            .nullable()
            .optional(),

        warrantyExpiresAt: z
            .coerce.date()
            .nullable()
            .optional(),

        purchaseDate: z
            .coerce.date()
            .nullable()
            .optional(),

        purchaseCost: z
            .union([
                z.number().min(0, "Purchase cost must be non-negative."),
                z.string().regex(/^\d+(\.\d{1,2})?$/, "Purchase cost must be a valid currency amount."),
            ])
            .nullable()
            .optional(),

        notes: z
            .string()
            .trim()
            .max(4000, "Notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        tags: assetTagsArraySchema
            .optional(),

        metadata: assetMetadataSchema,
    })
    .strict();

export const UpdateAssetSchema = updateAssetSchema;
export type UpdateAssetSchemaInput = z.infer<typeof updateAssetSchema>;

/**
 * Payload schema for transitioning the operational lifecycle status of an Asset.
 *
 * Endpoint: PATCH /api/assets/[assetId]/status
 *
 * Enforces the conditional requirement of `statusReason` according to the transition matrix.
 */
export const transitionAssetStatusSchema = z
    .object({
        fromStatus: assetStatusSchema.optional(),
        toStatus: assetStatusSchema,
        statusReason: z
            .string()
            .trim()
            .max(2000, "Status reason cannot exceed 2000 characters.")
            .nullable()
            .optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        const hasNonEmptyReason =
            data.statusReason !== null &&
            data.statusReason !== undefined &&
            data.statusReason.trim().length > 0;

        // If fromStatus is specified in the payload, enforce transition pair matrix rule
        if (data.fromStatus) {
            const requiresReason = isReasonRequiredForTransition(data.fromStatus, data.toStatus);
            if (requiresReason && !hasNonEmptyReason) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Status reason is required when transitioning from ${data.fromStatus} to ${data.toStatus}.`,
                    path: ["statusReason"],
                });
            }
        } else {
            // Target statuses where all inbound transitions unconditionally require a reason
            const UNCONDITIONAL_REASON_TARGETS = new Set(["DECOMMISSIONED", "RETIRED", "OUT_OF_SERVICE"]);
            if (UNCONDITIONAL_REASON_TARGETS.has(data.toStatus) && !hasNonEmptyReason) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Status reason is required when transitioning status to ${data.toStatus}.`,
                    path: ["statusReason"],
                });
            }
        }
    });

export const TransitionAssetStatusSchema = transitionAssetStatusSchema;
export type TransitionAssetStatusSchemaInput = z.infer<typeof transitionAssetStatusSchema>;

/**
 * Payload schema for transferring an Asset to a different physical ServiceLocation.
 *
 * Endpoint: POST /api/assets/[assetId]/transfer/location
 */
export const transferAssetLocationSchema = z
    .object({
        locationId: z
            .string()
            .trim()
            .min(1, "Location ID is required."),

        subLocationNotes: z
            .string()
            .trim()
            .max(2000, "Sub-location notes cannot exceed 2000 characters.")
            .nullable()
            .optional(),

        transferReason: z
            .string()
            .trim()
            .min(1, "Transfer reason is required when moving asset location.")
            .max(2000, "Transfer reason cannot exceed 2000 characters."),
    })
    .strict();

export const TransferAssetLocationSchema = transferAssetLocationSchema;
export type TransferAssetLocationSchemaInput = z.infer<typeof transferAssetLocationSchema>;

/**
 * Payload schema for transferring an Asset to a different Customer (ownership transfer).
 *
 * Endpoint: POST /api/assets/[assetId]/transfer/ownership
 */
export const transferAssetOwnershipSchema = z
    .object({
        customerId: z
            .string()
            .trim()
            .min(1, "Customer ID is required."),

        locationId: z
            .string()
            .trim()
            .min(1, "Location ID must not be empty.")
            .nullable()
            .optional(),

        subLocationNotes: z
            .string()
            .trim()
            .max(2000, "Sub-location notes cannot exceed 2000 characters.")
            .nullable()
            .optional(),

        transferReason: z
            .string()
            .trim()
            .min(1, "Transfer reason is required when transferring asset ownership.")
            .max(2000, "Transfer reason cannot exceed 2000 characters."),
    })
    .strict();

export const TransferAssetOwnershipSchema = transferAssetOwnershipSchema;
export type TransferAssetOwnershipSchemaInput = z.infer<typeof transferAssetOwnershipSchema>;

/**
 * Query parameter schema for Asset directory list, search, filter, and pagination.
 *
 * Endpoint: GET /api/assets
 */
export const getAssetsQuerySchema = z.object({
    search: z
        .string()
        .trim()
        .max(100, "Search query cannot exceed 100 characters.")
        .optional(),

    status: assetStatusSchema.optional(),

    customerId: z
        .string()
        .trim()
        .min(1, "Customer ID must not be empty.")
        .optional(),

    locationId: z
        .string()
        .trim()
        .min(1, "Location ID must not be empty.")
        .optional(),

    categoryId: z
        .string()
        .trim()
        .min(1, "Category ID must not be empty.")
        .optional(),

    tags: z
        .union([
            z.string().trim().transform((val) => val.split(",").map((t) => t.trim()).filter(Boolean)),
            z.array(z.string().trim()),
        ])
        .optional(),

    manufacturer: z
        .string()
        .trim()
        .max(100, "Manufacturer cannot exceed 100 characters.")
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
        .default(20),

    sortBy: z
        .enum(ASSET_SORT_FIELDS, {
            error: `Sort field must be one of: ${ASSET_SORT_FIELDS.join(", ")}.`,
        })
        .default("createdAt"),

    sortOrder: z
        .enum(["asc", "desc"], {
            error: "Sort order must be 'asc' or 'desc'.",
        })
        .default("desc"),
});

export const GetAssetsQuerySchema = getAssetsQuerySchema;
export type GetAssetsQuerySchemaInput = z.infer<typeof getAssetsQuerySchema>;

export const ASSET_HISTORY_EVENT_TYPES = [
    "CREATED",
    "UPDATED",
    "STATUS_CHANGED",
    "LOCATION_TRANSFERRED",
    "OWNERSHIP_TRANSFERRED",
    "DECOMMISSIONED",
    "REACTIVATED",
    "RETIRED",
] as const;

export type AssetHistoryEventTypeType = (typeof ASSET_HISTORY_EVENT_TYPES)[number];

export const assetHistoryEventTypeSchema = z.enum(ASSET_HISTORY_EVENT_TYPES, {
    error: "Event type must be one of: CREATED, UPDATED, STATUS_CHANGED, LOCATION_TRANSFERRED, OWNERSHIP_TRANSFERRED, DECOMMISSIONED, REACTIVATED, RETIRED.",
});

/**
 * Query parameter schema for AssetHistory timeline retrieval.
 *
 * Endpoint: GET /api/assets/[assetId]/history
 */
export const getAssetHistoryQuerySchema = z.object({
    eventType: z
        .union([
            assetHistoryEventTypeSchema,
            z.array(assetHistoryEventTypeSchema),
            z
                .string()
                .trim()
                .transform((val) => val.split(",").map((s) => s.trim()).filter(Boolean))
                .pipe(z.array(assetHistoryEventTypeSchema)),
        ])
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
        .default(20),

    sortOrder: z
        .enum(["asc", "desc"], {
            error: "Sort order must be 'asc' or 'desc'.",
        })
        .default("desc"),
});

export const GetAssetHistoryQuerySchema = getAssetHistoryQuerySchema;
export type GetAssetHistoryQuerySchemaInput = z.infer<typeof getAssetHistoryQuerySchema>;

