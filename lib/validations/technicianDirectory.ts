import { z } from "zod";
import { employeeStatusSchema } from "./employee";

export const getTechniciansQuerySchema = z.object({
    search: z
        .string()
        .trim()
        .max(100, "Search query must contain less than 100 characters.")
        .optional(),
    employeeStatus: employeeStatusSchema.optional(),
    departmentId: z.string().trim().min(1).optional(),
    jobTitleId: z.string().trim().min(1).optional(),
    serviceAreaId: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().min(1, "Page must be at least 1.").default(1),
    pageSize: z.coerce
        .number()
        .int()
        .min(1, "Page size must be at least 1.")
        .max(100, "Page size must not exceed 100.")
        .default(20),
});

export type GetTechniciansQueryInput = z.input<
    typeof getTechniciansQuerySchema
>;

export type GetTechniciansQueryOutput = z.output<
    typeof getTechniciansQuerySchema
>;
