import { z } from "zod";

export const WORK_TYPE_STATUSES = [
    "ACTIVE",
    "INACTIVE",
] as const;

export type WorkTypeStatusType = (typeof WORK_TYPE_STATUSES)[number];

export const workTypeStatusSchema = z.enum(WORK_TYPE_STATUSES, {
    error: "Status must be one of: ACTIVE, INACTIVE.",
});

export const workTypeCodeSchema = z
    .string()
    .trim()
    .max(50, "Work type code must contain less than 50 characters.")
    .refine(
        (val) => val === "" || /^[A-Za-z0-9\-_]+$/.test(val),
        "Work type code may only contain letters, numbers, hyphens, and underscores.",
    )
    .transform((val) => {
        if (val === "") return null;
        return val.toUpperCase();
    })
    .nullable()
    .optional();

export const workTypeEstimatedDurationSchema = z
    .number()
    .int("Estimated duration must be an integer.")
    .min(5, "Estimated duration must be at least 5 minutes.")
    .max(1440, "Estimated duration must not exceed 1440 minutes (24 hours).")
    .nullable()
    .optional();

export const createWorkTypeSchema = z.object({
    catalogId: z
        .string()
        .trim()
        .min(1, "Catalog ID is required."),

    name: z
        .string()
        .trim()
        .min(1, "Work type name must not be empty.")
        .max(150, "Work type name must contain less than 150 characters."),

    code: workTypeCodeSchema,

    description: z
        .string()
        .trim()
        .max(2000, "Description must contain less than 2000 characters.")
        .nullable()
        .optional(),

    estimatedDuration: workTypeEstimatedDurationSchema,

    sortOrder: z
        .number()
        .int("Sort order must be an integer.")
        .default(0)
        .optional(),
});

export type CreateWorkTypeInput = z.infer<typeof createWorkTypeSchema>;

export const updateWorkTypeSchema = z.object({
    catalogId: z
        .string()
        .trim()
        .min(1, "Catalog ID is required.")
        .optional(),

    name: z
        .string()
        .trim()
        .min(1, "Work type name must not be empty.")
        .max(150, "Work type name must contain less than 150 characters.")
        .optional(),

    code: workTypeCodeSchema,

    description: z
        .string()
        .trim()
        .max(2000, "Description must contain less than 2000 characters.")
        .nullable()
        .optional(),

    estimatedDuration: workTypeEstimatedDurationSchema,

    sortOrder: z
        .number()
        .int("Sort order must be an integer.")
        .optional(),
});

export type UpdateWorkTypeInput = z.infer<typeof updateWorkTypeSchema>;

export const updateWorkTypeStatusSchema = z.union([
    z.object({
        status: workTypeStatusSchema,
    }),
    workTypeStatusSchema.transform((status) => ({ status })),
]);

export const changeWorkTypeStatusSchema = updateWorkTypeStatusSchema;

export type UpdateWorkTypeStatusInput = z.infer<typeof updateWorkTypeStatusSchema>;
export type ChangeWorkTypeStatusInput = UpdateWorkTypeStatusInput;

export const workTypeQuerySchema = z.object({
    search: z
        .string()
        .trim()
        .max(100, "Search query must contain less than 100 characters.")
        .optional(),

    catalogId: z
        .string()
        .trim()
        .min(1, "Catalog ID must not be empty.")
        .optional(),

    status: workTypeStatusSchema.optional(),

    page: z.coerce.number().int().min(1, "Page must be at least 1.").default(1),

    pageSize: z.coerce
        .number()
        .int()
        .min(1, "Page size must be at least 1.")
        .max(100, "Page size must not exceed 100.")
        .default(20),

    sortBy: z
        .enum([
            "name",
            "code",
            "estimatedDuration",
            "status",
            "sortOrder",
            "createdAt",
            "updatedAt",
        ])
        .optional()
        .default("sortOrder"),

    sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
});

export const getWorkTypesQuerySchema = workTypeQuerySchema;

export type WorkTypeQueryInput = z.input<typeof workTypeQuerySchema>;
export type WorkTypeQueryOutput = z.output<typeof workTypeQuerySchema>;
export type GetWorkTypesQueryInput = WorkTypeQueryInput;
export type GetWorkTypesQueryOutput = WorkTypeQueryOutput;
