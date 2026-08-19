import { z } from "zod";

export const JOB_TITLE_STATUSES = [
    "ACTIVE",
    "INACTIVE",
] as const;

export type JobTitleStatusType = (typeof JOB_TITLE_STATUSES)[number];

export const jobTitleStatusSchema = z.enum(JOB_TITLE_STATUSES, {
    error: "Status must be one of: ACTIVE, INACTIVE.",
});

export const createJobTitleSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Job title name must not be empty.")
        .max(100, "Job title name must contain less than 100 characters."),

    description: z
        .string()
        .trim()
        .max(1000, "Description must contain less than 1000 characters.")
        .nullable()
        .optional(),

    status: jobTitleStatusSchema.default("ACTIVE"),
});

export type CreateJobTitleInput = z.infer<typeof createJobTitleSchema>;

export const updateJobTitleSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Job title name must not be empty.")
        .max(100, "Job title name must contain less than 100 characters.")
        .optional(),

    description: z
        .string()
        .trim()
        .max(1000, "Description must contain less than 1000 characters.")
        .nullable()
        .optional(),

    status: jobTitleStatusSchema.optional(),
});

export type UpdateJobTitleInput = z.infer<typeof updateJobTitleSchema>;

export const updateJobTitleStatusSchema = z.union([
    z.object({
        status: jobTitleStatusSchema,
    }),
    jobTitleStatusSchema.transform((status) => ({ status })),
]);

export type UpdateJobTitleStatusInput = z.infer<typeof updateJobTitleStatusSchema>;
