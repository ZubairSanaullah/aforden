import { z } from "zod";
import {
    InventoryLocationStatus,
    InventoryLocationType,
} from "@/generated/prisma/client";

export const INVENTORY_LOCATION_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type InventoryLocationStatusType = (typeof INVENTORY_LOCATION_STATUSES)[number];

export const INVENTORY_LOCATION_TYPES = [
    "WAREHOUSE",
    "VEHICLE",
    "TECHNICIAN_STOCK",
    "OTHER",
] as const;
export type InventoryLocationTypeType = (typeof INVENTORY_LOCATION_TYPES)[number];

export const inventoryLocationStatusSchema = z.enum(INVENTORY_LOCATION_STATUSES, {
    error: "Status must be one of: ACTIVE, INACTIVE.",
});

export const inventoryLocationTypeSchema = z.enum(INVENTORY_LOCATION_TYPES, {
    error: "Invalid inventory location type.",
});

/**
 * Zod validation schema for creating an InventoryLocation.
 * Invariants:
 * - If locationType === TECHNICIAN_STOCK, technicianProfileId is required.
 * - If locationType !== TECHNICIAN_STOCK, technicianProfileId must be null/omitted.
 * - status cannot be supplied on creation (defaults to ACTIVE).
 */
export const createInventoryLocationSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, "Location name cannot be empty.")
            .max(100, "Location name must be 100 characters or less."),

        code: z
            .string()
            .trim()
            .max(20, "Code must be 20 characters or less.")
            .nullish()
            .transform((val) => (val === "" || val === undefined ? null : val)),

        locationType: z
            .nativeEnum(InventoryLocationType)
            .default(InventoryLocationType.WAREHOUSE),

        technicianProfileId: z
            .string()
            .trim()
            .nullish()
            .transform((val) => (val === "" || val === undefined ? null : val)),

        addressLine1: z
            .string()
            .trim()
            .max(255, "Address line 1 must be 255 characters or less.")
            .nullish()
            .transform((val) => (val === "" || val === undefined ? null : val)),

        addressLine2: z
            .string()
            .trim()
            .max(255, "Address line 2 must be 255 characters or less.")
            .nullish()
            .transform((val) => (val === "" || val === undefined ? null : val)),

        city: z
            .string()
            .trim()
            .max(100, "City must be 100 characters or less.")
            .nullish()
            .transform((val) => (val === "" || val === undefined ? null : val)),

        state: z
            .string()
            .trim()
            .max(100, "State must be 100 characters or less.")
            .nullish()
            .transform((val) => (val === "" || val === undefined ? null : val)),

        postalCode: z
            .string()
            .trim()
            .max(20, "Postal code must be 20 characters or less.")
            .nullish()
            .transform((val) => (val === "" || val === undefined ? null : val)),

        country: z
            .string()
            .trim()
            .max(100, "Country must be 100 characters or less.")
            .nullish()
            .transform((val) => (val === "" || val === undefined ? null : val)),

        notes: z
            .string()
            .trim()
            .max(2000, "Notes must be 2000 characters or less.")
            .nullish()
            .transform((val) => (val === "" || val === undefined ? null : val)),
    })
    .superRefine((data, ctx) => {
        if (data.locationType === InventoryLocationType.TECHNICIAN_STOCK) {
            if (!data.technicianProfileId) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        "technicianProfileId is required when locationType is TECHNICIAN_STOCK.",
                    path: ["technicianProfileId"],
                });
            }
        } else {
            if (data.technicianProfileId) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        "technicianProfileId can only be set when locationType is TECHNICIAN_STOCK.",
                    path: ["technicianProfileId"],
                });
            }
        }
    });

/**
 * Zod validation schema for updating an InventoryLocation.
 * Note: `status` mutations are strictly forbidden through this schema;
 * status transitions must go through `transitionInventoryLocationStatus`.
 */
export const updateInventoryLocationSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, "Location name cannot be empty.")
            .max(100, "Location name must be 100 characters or less.")
            .optional(),

        code: z
            .string()
            .trim()
            .max(20, "Code must be 20 characters or less.")
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        locationType: z
            .nativeEnum(InventoryLocationType)
            .optional(),

        technicianProfileId: z
            .string()
            .trim()
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        addressLine1: z
            .string()
            .trim()
            .max(255, "Address line 1 must be 255 characters or less.")
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        addressLine2: z
            .string()
            .trim()
            .max(255, "Address line 2 must be 255 characters or less.")
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        city: z
            .string()
            .trim()
            .max(100, "City must be 100 characters or less.")
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        state: z
            .string()
            .trim()
            .max(100, "State must be 100 characters or less.")
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        postalCode: z
            .string()
            .trim()
            .max(20, "Postal code must be 20 characters or less.")
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        country: z
            .string()
            .trim()
            .max(100, "Country must be 100 characters or less.")
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        notes: z
            .string()
            .trim()
            .max(2000, "Notes must be 2000 characters or less.")
            .nullish()
            .transform((val) => (val === "" ? null : val)),

        status: z.never().optional(),
    })
    .strict()
    // Note: This schema superRefine provides early rejection when both fields are provided in the update payload.
    // The updateInventoryLocation service authoritatively enforces the TECHNICIAN_STOCK <-> technicianProfileId
    // invariant against merged database state (force-clearing technicianProfileId for non-TECHNICIAN_STOCK locations).
    .superRefine((data, ctx) => {
        if (
            data.locationType === InventoryLocationType.TECHNICIAN_STOCK &&
            data.technicianProfileId === null
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    "technicianProfileId cannot be null when locationType is TECHNICIAN_STOCK.",
                path: ["technicianProfileId"],
            });
        }
        if (
            data.locationType !== undefined &&
            data.locationType !== InventoryLocationType.TECHNICIAN_STOCK &&
            data.technicianProfileId
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    "technicianProfileId can only be set when locationType is TECHNICIAN_STOCK.",
                path: ["technicianProfileId"],
            });
        }
    });

/**
 * Zod validation schema for transitioning InventoryLocation status.
 */
export const transitionInventoryLocationStatusSchema = z.object({
    status: z.nativeEnum(InventoryLocationStatus),
});

/**
 * Zod validation schema for listing and filtering InventoryLocations.
 */
export const getInventoryLocationsQuerySchema = z.object({
    search: z.string().trim().optional(),
    status: z.nativeEnum(InventoryLocationStatus).optional(),
    locationType: z.nativeEnum(InventoryLocationType).optional(),
    technicianProfileId: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z
        .enum([
            "name",
            "code",
            "locationType",
            "status",
            "createdAt",
            "updatedAt",
        ])
        .default("name"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type CreateInventoryLocationSchemaInput = z.input<typeof createInventoryLocationSchema>;
export type CreateInventoryLocationSchemaOutput = z.output<typeof createInventoryLocationSchema>;

export type UpdateInventoryLocationSchemaInput = z.input<typeof updateInventoryLocationSchema>;
export type UpdateInventoryLocationSchemaOutput = z.output<typeof updateInventoryLocationSchema>;

export type TransitionInventoryLocationStatusSchemaInput = z.input<typeof transitionInventoryLocationStatusSchema>;
export type TransitionInventoryLocationStatusSchemaOutput = z.output<typeof transitionInventoryLocationStatusSchema>;

export type GetInventoryLocationsQuerySchemaInput = z.input<typeof getInventoryLocationsQuerySchema>;
export type GetInventoryLocationsQuerySchemaOutput = z.output<typeof getInventoryLocationsQuerySchema>;
