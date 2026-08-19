import { z } from "zod";

export const EMPLOYEE_STATUSES = [
    "ACTIVE",
    "INACTIVE",
    "ON_LEAVE",
    "TERMINATED",
] as const;

export type EmployeeStatusType = (typeof EMPLOYEE_STATUSES)[number];

export const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES, {
    error: "Status must be one of: ACTIVE, INACTIVE, ON_LEAVE, TERMINATED.",
});

export const createEmployeeSchema = z.object({
    employeeNumber: z
        .string()
        .trim()
        .min(1, "Employee number must not be empty.")
        .max(50, "Employee number must contain less than 50 characters.")
        .nullable()
        .optional(),

    departmentId: z
        .string()
        .trim()
        .min(1, "Department ID must not be empty.")
        .nullable()
        .optional(),

    jobTitleId: z
        .string()
        .trim()
        .min(1, "Job title ID must not be empty.")
        .nullable()
        .optional(),

    displayName: z
        .string()
        .trim()
        .min(1, "Display name must not be empty.")
        .max(100, "Display name must contain less than 100 characters.")
        .nullable()
        .optional(),

    phone: z
        .string()
        .trim()
        .min(1, "Phone number must not be empty.")
        .max(50, "Phone number must contain less than 50 characters.")
        .nullable()
        .optional(),

    hireDate: z
        .coerce
        .date()
        .nullable()
        .optional(),

    status: employeeStatusSchema.default("ACTIVE"),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object({
    employeeNumber: z
        .string()
        .trim()
        .min(1, "Employee number must not be empty.")
        .max(50, "Employee number must contain less than 50 characters.")
        .nullable()
        .optional(),

    departmentId: z
        .string()
        .trim()
        .min(1, "Department ID must not be empty.")
        .nullable()
        .optional(),

    jobTitleId: z
        .string()
        .trim()
        .min(1, "Job title ID must not be empty.")
        .nullable()
        .optional(),

    displayName: z
        .string()
        .trim()
        .min(1, "Display name must not be empty.")
        .max(100, "Display name must contain less than 100 characters.")
        .nullable()
        .optional(),

    phone: z
        .string()
        .trim()
        .min(1, "Phone number must not be empty.")
        .max(50, "Phone number must contain less than 50 characters.")
        .nullable()
        .optional(),

    hireDate: z
        .coerce
        .date()
        .nullable()
        .optional(),

    status: employeeStatusSchema.optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes must contain less than 2000 characters.")
        .nullable()
        .optional(),
});

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const updateEmployeeStatusSchema = z.union([
    z.object({
        status: employeeStatusSchema,
    }),
    employeeStatusSchema.transform((status) => ({ status })),
]);

export type UpdateEmployeeStatusInput = z.infer<typeof updateEmployeeStatusSchema>;
