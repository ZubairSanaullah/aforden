import { z } from "zod";

export const listPublicPartsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50).optional(),
    search: z.string().trim().max(100).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    unitOfMeasure: z
        .enum([
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
        ])
        .optional(),
});

export type ListPublicPartsQueryInput = z.infer<
    typeof listPublicPartsQuerySchema
>;
