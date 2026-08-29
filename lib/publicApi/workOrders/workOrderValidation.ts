import { z } from "zod";

export const PUBLIC_WORK_ORDER_STATUSES = [
    "OPEN",
    "ASSIGNED",
    "IN_PROGRESS",
    "ON_HOLD",
    "COMPLETED",
    "CANCELLED",
] as const;

export const PUBLIC_WORK_ORDER_PRIORITIES = [
    "LOW",
    "MEDIUM",
    "HIGH",
    "URGENT",
] as const;

export const publicCreateWorkOrderSchema = z
    .object({
        customerId: z
            .string({
                error: "customerId is required.",
            })
            .trim()
            .min(1, "customerId is required."),

        locationId: z
            .string({
                error: "locationId is required.",
            })
            .trim()
            .min(1, "locationId is required."),

        workTypeId: z
            .string({
                error: "workTypeId is required.",
            })
            .trim()
            .min(1, "workTypeId is required."),

        title: z
            .string({
                error: "title is required.",
            })
            .trim()
            .min(1, "title must not be empty.")
            .max(200, "title must contain less than 200 characters."),

        priority: z
            .enum(PUBLIC_WORK_ORDER_PRIORITIES, {
                error: "priority must be one of: LOW, MEDIUM, HIGH, URGENT.",
            })
            .default("MEDIUM"),

        description: z
            .string()
            .trim()
            .max(4000, "description must contain less than 4000 characters.")
            .nullable()
            .optional(),

        assetId: z
            .string()
            .trim()
            .min(1, "assetId must not be empty.")
            .nullable()
            .optional(),
    })
    .strict();

export type PublicCreateWorkOrderInput = z.infer<typeof publicCreateWorkOrderSchema>;

export const publicUpdateWorkOrderSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(1, "title must not be empty.")
            .max(200, "title must contain less than 200 characters.")
            .optional(),

        priority: z
            .enum(PUBLIC_WORK_ORDER_PRIORITIES, {
                error: "priority must be one of: LOW, MEDIUM, HIGH, URGENT.",
            })
            .optional(),

        description: z
            .string()
            .trim()
            .max(4000, "description must contain less than 4000 characters.")
            .nullable()
            .optional(),

        assetId: z
            .string()
            .trim()
            .min(1, "assetId must not be empty.")
            .nullable()
            .optional(),
    })
    .strict();

export type PublicUpdateWorkOrderInput = z.infer<typeof publicUpdateWorkOrderSchema>;
