import { z } from "zod";

export const listPublicInvoicesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50).optional(),
    customerId: z.string().trim().min(1).optional(),
    locationId: z.string().trim().min(1).optional(),
    quoteId: z.string().trim().min(1).optional(),
    workOrderId: z.string().trim().min(1).optional(),
    status: z
        .enum([
            "DRAFT",
            "ISSUED",
            "PARTIALLY_PAID",
            "PAID",
            "OVERDUE",
            "VOID",
        ])
        .optional(),
    search: z.string().trim().max(100).optional(),
});

export type ListPublicInvoicesQueryInput = z.infer<
    typeof listPublicInvoicesQuerySchema
>;
