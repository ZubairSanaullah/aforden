import { z } from "zod";
import { StockMovementType } from "@/generated/prisma/client";

/**
 * Validation schema for receiving stock into an inventory location.
 */
export const receiveStockSchema = z.object({
    partId: z
        .string()
        .trim()
        .min(1, "Part ID is required."),

    locationId: z
        .string()
        .trim()
        .min(1, "Location ID is required."),

    quantity: z
        .coerce
        .number()
        .positive("Quantity must be greater than zero."),

    unitCostSnapshot: z
        .coerce
        .number()
        .nonnegative("Unit cost snapshot must be non-negative.")
        .nullish()
        .transform((val) => (val === undefined ? undefined : val)),

    reason: z
        .string()
        .trim()
        .max(2000, "Reason must be 2000 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),

    referenceNumber: z
        .string()
        .trim()
        .max(100, "Reference number must be 100 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),
});

export type ReceiveStockSchemaInput = z.input<typeof receiveStockSchema>;
export type ReceiveStockSchemaOutput = z.output<typeof receiveStockSchema>;

/**
 * Validation schema for transferring stock between two inventory locations.
 * Note: Same-location validation (fromLocationId === toLocationId) is checked in transferStock service
 * to throw the dedicated TransferSameLocationError (422).
 */
export const transferStockSchema = z.object({
    partId: z
        .string()
        .trim()
        .min(1, "Part ID is required."),

    fromLocationId: z
        .string()
        .trim()
        .min(1, "Source location ID is required."),

    toLocationId: z
        .string()
        .trim()
        .min(1, "Destination location ID is required."),

    quantity: z
        .coerce
        .number()
        .positive("Quantity must be greater than zero."),

    reason: z
        .string()
        .trim()
        .max(2000, "Reason must be 2000 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),

    referenceNumber: z
        .string()
        .trim()
        .max(100, "Reference number must be 100 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),
});

export type TransferStockSchemaInput = z.input<typeof transferStockSchema>;
export type TransferStockSchemaOutput = z.output<typeof transferStockSchema>;

/**
 * Validation schema for adjusting stock at an inventory location.
 * Note: quantity is a signed non-zero number (can be positive or negative), and reason is mandatory.
 */
export const adjustStockSchema = z.object({
    partId: z
        .string()
        .trim()
        .min(1, "Part ID is required."),

    locationId: z
        .string()
        .trim()
        .min(1, "Location ID is required."),

    quantity: z
        .coerce
        .number()
        .refine((val) => val !== 0, "Adjustment quantity cannot be zero."),

    reason: z
        .string()
        .trim()
        .min(1, "Reason is required for stock adjustments.")
        .max(2000, "Reason must be 2000 characters or less."),

    referenceNumber: z
        .string()
        .trim()
        .max(100, "Reference number must be 100 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),
});

export type AdjustStockSchemaInput = z.input<typeof adjustStockSchema>;
export type AdjustStockSchemaOutput = z.output<typeof adjustStockSchema>;

/**
 * Validation schema for reserving stock at an inventory location.
 */
export const reserveStockSchema = z.object({
    partId: z
        .string()
        .trim()
        .min(1, "Part ID is required."),

    locationId: z
        .string()
        .trim()
        .min(1, "Location ID is required."),

    quantity: z
        .coerce
        .number()
        .positive("Quantity must be greater than zero."),

    workOrderId: z
        .string()
        .trim()
        .max(100, "Work order ID must be 100 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),

    reason: z
        .string()
        .trim()
        .max(2000, "Reason must be 2000 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),

    referenceNumber: z
        .string()
        .trim()
        .max(100, "Reference number must be 100 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),
});

export type ReserveStockSchemaInput = z.input<typeof reserveStockSchema>;
export type ReserveStockSchemaOutput = z.output<typeof reserveStockSchema>;

/**
 * Validation schema for releasing reserved stock at an inventory location.
 */
export const releaseStockSchema = z.object({
    partId: z
        .string()
        .trim()
        .min(1, "Part ID is required."),

    locationId: z
        .string()
        .trim()
        .min(1, "Location ID is required."),

    quantity: z
        .coerce
        .number()
        .positive("Quantity must be greater than zero."),

    workOrderId: z
        .string()
        .trim()
        .max(100, "Work order ID must be 100 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),

    reason: z
        .string()
        .trim()
        .max(2000, "Reason must be 2000 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),

    referenceNumber: z
        .string()
        .trim()
        .max(100, "Reference number must be 100 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),
});

export type ReleaseStockSchemaInput = z.input<typeof releaseStockSchema>;
export type ReleaseStockSchemaOutput = z.output<typeof releaseStockSchema>;

/**
 * Validation schema for consuming stock on a WorkOrder.
 * workOrderId is required.
 */
export const consumeStockSchema = z.object({
    partId: z
        .string()
        .trim()
        .min(1, "Part ID is required."),

    locationId: z
        .string()
        .trim()
        .min(1, "Location ID is required."),

    quantity: z
        .coerce
        .number()
        .positive("Quantity must be greater than zero."),

    workOrderId: z
        .string()
        .trim()
        .min(1, "Work order ID is required for stock consumption."),

    originalWorkOrderPartId: z
        .string()
        .trim()
        .max(100, "Original work order part ID must be 100 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must be 2000 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),

    reason: z
        .string()
        .trim()
        .max(2000, "Reason must be 2000 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),

    referenceNumber: z
        .string()
        .trim()
        .max(100, "Reference number must be 100 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),
});

export type ConsumeStockSchemaInput = z.input<typeof consumeStockSchema>;
export type ConsumeStockSchemaOutput = z.output<typeof consumeStockSchema>;

/**
 * Validation schema for returning previously consumed parts from a WorkOrder back into inventory stock.
 * originalWorkOrderPartId is required.
 */
export const returnStockSchema = z.object({
    partId: z
        .string()
        .trim()
        .min(1, "Part ID is required."),

    locationId: z
        .string()
        .trim()
        .min(1, "Location ID is required."),

    quantity: z
        .coerce
        .number()
        .positive("Quantity must be greater than zero."),

    workOrderId: z
        .string()
        .trim()
        .min(1, "Work order ID is required for stock returns."),

    originalWorkOrderPartId: z
        .string()
        .trim()
        .min(1, "Original work order part ID is required for stock returns."),

    reason: z
        .string()
        .trim()
        .max(2000, "Reason must be 2000 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),

    referenceNumber: z
        .string()
        .trim()
        .max(100, "Reference number must be 100 characters or less.")
        .nullish()
        .transform((val) => (val === "" ? null : val)),
});

export type ReturnStockSchemaInput = z.input<typeof returnStockSchema>;
export type ReturnStockSchemaOutput = z.output<typeof returnStockSchema>;

/**
 * Validation schema for querying and filtering the StockMovement ledger.
 */
export const listStockMovementsQuerySchema = z.object({
    partId: z
        .string()
        .trim()
        .nullish()
        .transform((val) => (val === "" ? undefined : val)),

    locationId: z
        .string()
        .trim()
        .nullish()
        .transform((val) => (val === "" ? undefined : val)),

    movementType: z
        .nativeEnum(StockMovementType)
        .nullish()
        .transform((val) => val ?? undefined),

    workOrderId: z
        .string()
        .trim()
        .nullish()
        .transform((val) => (val === "" ? undefined : val)),

    originalWorkOrderPartId: z
        .string()
        .trim()
        .nullish()
        .transform((val) => (val === "" ? undefined : val)),

    actorMemberId: z
        .string()
        .trim()
        .nullish()
        .transform((val) => (val === "" ? undefined : val)),

    startDate: z
        .string()
        .datetime({ offset: true })
        .or(z.date())
        .nullish()
        .transform((val) => (val ? new Date(val) : undefined)),

    endDate: z
        .string()
        .datetime({ offset: true })
        .or(z.date())
        .nullish()
        .transform((val) => (val ? new Date(val) : undefined)),

    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(50),
    sortBy: z.enum(["createdAt", "quantity"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type ListStockMovementsQueryInput = z.input<typeof listStockMovementsQuerySchema>;
export type ListStockMovementsQueryOutput = z.output<typeof listStockMovementsQuerySchema>;
