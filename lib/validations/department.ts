import { z } from "zod";

export const DEPARTMENT_STATUSES = [
    "ACTIVE",
    "INACTIVE",
] as const;

export type DepartmentStatusType = (typeof DEPARTMENT_STATUSES)[number];

export const departmentStatusSchema = z.enum(DEPARTMENT_STATUSES, {
    error: "Status must be one of: ACTIVE, INACTIVE.",
});

export const createDepartmentSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Department name must not be empty.")
        .max(100, "Department name must contain less than 100 characters."),

    description: z
        .string()
        .trim()
        .max(1000, "Description must contain less than 1000 characters.")
        .nullable()
        .optional(),

    status: departmentStatusSchema.default("ACTIVE"),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Department name must not be empty.")
        .max(100, "Department name must contain less than 100 characters.")
        .optional(),

    description: z
        .string()
        .trim()
        .max(1000, "Description must contain less than 1000 characters.")
        .nullable()
        .optional(),

    status: departmentStatusSchema.optional(),
});

export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const updateDepartmentStatusSchema = z.union([
    z.object({
        status: departmentStatusSchema,
    }),
    departmentStatusSchema.transform((status) => ({ status })),
]);

export type UpdateDepartmentStatusInput = z.infer<typeof updateDepartmentStatusSchema>;
