import { z } from "zod";

/**
 * Validation schema for single InventoryBalance point lookup parameters.
 */
export const getInventoryBalanceParamsSchema = z.object({
    partId: z
        .string()
        .trim()
        .min(1, "Part ID is required."),
    locationId: z
        .string()
        .trim()
        .min(1, "Location ID is required."),
});

/**
 * Validation schema for listing and filtering InventoryBalances.
 */
export const getInventoryBalancesQuerySchema = z.object({
    partId: z.string().trim().optional(),
    locationId: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z
        .enum([
            "quantityOnHand",
            "quantityReserved",
            "createdAt",
            "updatedAt",
        ])
        .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type GetInventoryBalanceParamsInput = z.input<typeof getInventoryBalanceParamsSchema>;
export type GetInventoryBalanceParamsOutput = z.output<typeof getInventoryBalanceParamsSchema>;

export type GetInventoryBalancesQuerySchemaInput = z.input<typeof getInventoryBalancesQuerySchema>;
export type GetInventoryBalancesQuerySchemaOutput = z.output<typeof getInventoryBalancesQuerySchema>;

/**
 * Validation schema for listing active stock reservations (balances where quantityReserved > 0).
 */
export const listReservationsQuerySchema = z.object({
    partId: z.string().trim().optional(),
    locationId: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z
        .enum([
            "quantityReserved",
            "quantityOnHand",
            "createdAt",
            "updatedAt",
        ])
        .default("quantityReserved"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type ListReservationsQueryInput = z.input<typeof listReservationsQuerySchema>;
export type ListReservationsQueryOutput = z.output<typeof listReservationsQuerySchema>;

/**
 * Validation schema for listing technician van stock balances.
 */
export const listTechnicianStockQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z
        .enum([
            "quantityOnHand",
            "quantityReserved",
            "createdAt",
            "updatedAt",
        ])
        .default("quantityOnHand"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type ListTechnicianStockQueryInput = z.input<typeof listTechnicianStockQuerySchema>;
export type ListTechnicianStockQueryOutput = z.output<typeof listTechnicianStockQuerySchema>;
