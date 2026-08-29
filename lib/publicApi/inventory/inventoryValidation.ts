import { z } from "zod";

export const listPublicInventoryBalancesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50).optional(),
    partId: z.string().trim().min(1).optional(),
    locationId: z.string().trim().min(1).optional(),
});

export type ListPublicInventoryBalancesQueryInput = z.infer<
    typeof listPublicInventoryBalancesQuerySchema
>;
