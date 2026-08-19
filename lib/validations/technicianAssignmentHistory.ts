import { z } from "zod";
import {
    assignmentWorkTypeSchema,
    technicianAssignmentStatusSchema,
} from "./technicianAssignment";

export const getTechnicianAssignmentHistoryQuerySchema = z
    .object({
        status: technicianAssignmentStatusSchema.optional(),
        workType: assignmentWorkTypeSchema.optional(),
        workReferenceId: z.string().trim().min(1).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
    })
    .refine(
        (data) => {
            if (data.from && data.to) {
                return data.from.getTime() < data.to.getTime();
            }
            return true;
        },
        {
            message: "From date must be earlier than to date.",
            path: ["from"],
        },
    );

export type GetTechnicianAssignmentHistoryQueryInput = z.input<
    typeof getTechnicianAssignmentHistoryQuerySchema
>;

export const getWorkspaceTechnicianAssignmentHistoryQuerySchema = z
    .object({
        technicianProfileId: z.string().trim().min(1).optional(),
        employeeId: z.string().trim().min(1).optional(),
        status: technicianAssignmentStatusSchema.optional(),
        workType: assignmentWorkTypeSchema.optional(),
        workReferenceId: z.string().trim().min(1).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
    })
    .refine(
        (data) => {
            if (data.from && data.to) {
                return data.from.getTime() < data.to.getTime();
            }
            return true;
        },
        {
            message: "From date must be earlier than to date.",
            path: ["from"],
        },
    );

export type GetWorkspaceTechnicianAssignmentHistoryQueryInput = z.input<
    typeof getWorkspaceTechnicianAssignmentHistoryQuerySchema
>;

export const getTechnicianAssignmentTimelineQuerySchema = z
    .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
    })
    .refine(
        (data) => {
            if (data.from && data.to) {
                return data.from.getTime() < data.to.getTime();
            }
            return true;
        },
        {
            message: "From date must be earlier than to date.",
            path: ["from"],
        },
    );

export type GetTechnicianAssignmentTimelineQueryInput = z.input<
    typeof getTechnicianAssignmentTimelineQuerySchema
>;

export const getTechnicianAssignmentHistorySummaryQuerySchema = z
    .object({
        technicianProfileId: z.string().trim().min(1).optional(),
        employeeId: z.string().trim().min(1).optional(),
        workType: assignmentWorkTypeSchema.optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
    })
    .refine(
        (data) => {
            if (data.from && data.to) {
                return data.from.getTime() < data.to.getTime();
            }
            return true;
        },
        {
            message: "From date must be earlier than to date.",
            path: ["from"],
        },
    );

export type GetTechnicianAssignmentHistorySummaryQueryInput = z.input<
    typeof getTechnicianAssignmentHistorySummaryQuerySchema
>;
