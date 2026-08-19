import { z } from "zod";
import {
    assignmentWorkTypeSchema,
    technicianAssignmentStatusSchema,
} from "./technicianAssignment";

export const getTechnicianAssignmentOverviewsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    technicianProfileId: z.string().trim().min(1).optional(),
    employeeId: z.string().trim().min(1).optional(),
    status: technicianAssignmentStatusSchema.optional(),
    workType: assignmentWorkTypeSchema.optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    search: z.string().trim().optional(),
});

export type GetTechnicianAssignmentOverviewsQueryInput = z.input<
    typeof getTechnicianAssignmentOverviewsQuerySchema
>;

export const getTechnicianScheduleQuerySchema = z.object({
    status: technicianAssignmentStatusSchema.optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    includeHistorical: z.coerce.boolean().default(false),
    now: z.coerce.date().optional(),
});

export type GetTechnicianScheduleQueryInput = z.input<
    typeof getTechnicianScheduleQuerySchema
>;

export const getTechnicianWorkloadQuerySchema = z.object({
    now: z.coerce.date().optional(),
});

export type GetTechnicianWorkloadQueryInput = z.input<
    typeof getTechnicianWorkloadQuerySchema
>;

export const getTechnicianAssignmentConflictsQuerySchema = z
    .object({
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
        excludeAssignmentId: z.string().trim().min(1).optional(),
    })
    .refine((data) => data.startsAt.getTime() < data.endsAt.getTime(), {
        message: "Start date/time must be strictly earlier than end date/time.",
        path: ["startsAt"],
    });

export type GetTechnicianAssignmentConflictsQueryInput = z.input<
    typeof getTechnicianAssignmentConflictsQuerySchema
>;

export const getTechnicianAssignmentStatsQuerySchema = z.object({
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    workType: assignmentWorkTypeSchema.optional(),
    technicianProfileId: z.string().trim().min(1).optional(),
    now: z.coerce.date().optional(),
});

export type GetTechnicianAssignmentStatsQueryInput = z.input<
    typeof getTechnicianAssignmentStatsQuerySchema
>;
