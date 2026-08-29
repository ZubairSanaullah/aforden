import { z } from "zod";

export const listPublicTechniciansQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50).optional(),
    search: z.string().trim().max(100).optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "TERMINATED", "ON_LEAVE"]).optional(),
    departmentId: z.string().trim().min(1).optional(),
    jobTitleId: z.string().trim().min(1).optional(),
    serviceAreaId: z.string().trim().min(1).optional(),
});

export type ListPublicTechniciansQueryInput = z.infer<
    typeof listPublicTechniciansQuerySchema
>;
