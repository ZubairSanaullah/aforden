import { z } from "zod";
import { PartStatus, PartUnitOfMeasure } from "@/generated/prisma/client";

export const PART_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type PartStatusType = (typeof PART_STATUSES)[number];

export const PART_UNIT_OF_MEASURES = [
    "EACH",
    "BOX",
    "PACK",
    "PAIR",
    "KIT",
    "FOOT",
    "METER",
    "LITER",
    "GAL",
    "LB",
    "KG",
    "ROLL",
    "SHEET",
    "SET",
] as const;
export type PartUnitOfMeasureType = (typeof PART_UNIT_OF_MEASURES)[number];

export const partStatusSchema = z.enum(PART_STATUSES, {
    error: "Status must be one of: ACTIVE, INACTIVE.",
});

export const partUnitOfMeasureSchema = z.enum(PART_UNIT_OF_MEASURES, {
    error: "Invalid unit of measure.",
});

/**
 * Zod validation schema for creating a Part in the catalog.
 */
export const createPartSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Part name cannot be empty.")
        .max(200, "Part name must be 200 characters or less."),

    sku: z
        .string()
        .trim()
        .max(50, "SKU must be 50 characters or less.")
        .nullish()
        .transform((val) => (val === "" || val === undefined ? null : val)),

    description: z
        .string()
        .trim()
        .max(4000, "Description must be 4000 characters or less.")
        .nullish()
        .transform((val) => (val === "" || val === undefined ? null : val)),

    unitOfMeasure: z
        .nativeEnum(PartUnitOfMeasure)
        .default(PartUnitOfMeasure.EACH),

    unitCost: z
        .number()
        .min(0, "Unit cost cannot be negative.")
        .max(9999999999.99, "Unit cost exceeds maximum allowed value.")
        .nullish()
        .transform((val) => (val === undefined ? null : val)),

    minimumStockLevel: z
        .number()
        .min(0, "Minimum stock level cannot be negative.")
        .max(99999999.9999, "Minimum stock level exceeds maximum allowed value.")
        .nullish()
        .transform((val) => (val === undefined ? null : val)),
});

/**
 * Zod validation schema for updating a Part in the catalog.
 * Note: `status` mutations are strictly forbidden through this schema;
 * status transitions must go through `transitionPartStatus`.
 */
export const updatePartSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, "Part name cannot be empty.")
            .max(200, "Part name must be 200 characters or less.")
            .optional(),

        sku: z
            .string()
            .trim()
            .max(50, "SKU must be 50 characters or less.")
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        description: z
            .string()
            .trim()
            .max(4000, "Description must be 4000 characters or less.")
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        unitOfMeasure: z
            .nativeEnum(PartUnitOfMeasure)
            .optional(),

        unitCost: z
            .number()
            .min(0, "Unit cost cannot be negative.")
            .max(9999999999.99, "Unit cost exceeds maximum allowed value.")
            .nullish(),

        minimumStockLevel: z
            .number()
            .min(0, "Minimum stock level cannot be negative.")
            .max(99999999.9999, "Minimum stock level exceeds maximum allowed value.")
            .nullish(),

        status: z.never().optional(),
    })
    .strict();

/**
 * Zod validation schema for transitioning Part status.
 */
export const transitionPartStatusSchema = z.object({
    status: z.nativeEnum(PartStatus),
});

/**
 * Zod validation schema for listing and filtering Parts.
 */
export const getPartsQuerySchema = z.object({
    search: z.string().trim().optional(),
    status: z.nativeEnum(PartStatus).optional(),
    unitOfMeasure: z.nativeEnum(PartUnitOfMeasure).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z
        .enum([
            "name",
            "sku",
            "status",
            "unitOfMeasure",
            "unitCost",
            "minimumStockLevel",
            "createdAt",
            "updatedAt",
        ])
        .default("name"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type CreatePartSchemaInput = z.input<typeof createPartSchema>;
export type CreatePartSchemaOutput = z.output<typeof createPartSchema>;

export type UpdatePartSchemaInput = z.input<typeof updatePartSchema>;
export type UpdatePartSchemaOutput = z.output<typeof updatePartSchema>;

export type TransitionPartStatusSchemaInput = z.input<typeof transitionPartStatusSchema>;
export type TransitionPartStatusSchemaOutput = z.output<typeof transitionPartStatusSchema>;

export type GetPartsQuerySchemaInput = z.input<typeof getPartsQuerySchema>;
export type GetPartsQuerySchemaOutput = z.output<typeof getPartsQuerySchema>;
