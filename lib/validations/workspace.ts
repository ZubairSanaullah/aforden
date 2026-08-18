import { z } from "zod";

export const createWorkspaceSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Workspace name must contain at least 2 characters")
        .max(100, "Workspace name must contain less than 100 characters"),

    timezone: z
        .string()
        .trim()
        .min(1, "Timezone is required")
        .max(100, "Timezone is invalid")
        .default("Asia/Karachi"),
});

export type CreateWorkspaceInput = z.infer<
    typeof createWorkspaceSchema
>;