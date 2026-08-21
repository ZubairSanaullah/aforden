import { z } from "zod";
import type {
    MembershipRole,
    WorkOrderStatus,
    WorkOrderPriority,
    TimeEntryType,
    TimeEntryStatus,
    TechnicianTimeEntry,
} from "@/generated/prisma/client";
import type { WorkOrderReadModel, PaginationMetadata } from "@/lib/services/workOrder/workOrder.types";
import {
    WORK_ORDER_STATUSES,
    WORK_ORDER_PRIORITIES,
} from "@/lib/validations/workOrder";

/**
 * Canonical technician execution context resolved on every technician endpoint.
 * Strictly server-derived from auth() session and workspace authorization.
 * (Section 3.2 of Phase 1.9.1 architecture contract)
 */
export interface TechnicianExecutionContext {
    userId: string;
    workspaceId: string;
    membershipId: string;
    role: MembershipRole;
    employeeId: string;
    technicianProfileId: string;
    technicianName: string;
}

/**
 * Validation schema for technician work queue query options.
 */
export const technicianWorkOrderQuerySchema = z.object({
    status: z.enum(WORK_ORDER_STATUSES).optional(),
    priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
    customerId: z.string().trim().min(1).optional(),
    locationId: z.string().trim().min(1).optional(),
    workTypeId: z.string().trim().min(1).optional(),
    assignedTechnicianId: z.string().trim().min(1).optional(),
    search: z.string().trim().optional(),

    page: z.coerce
        .number()
        .int()
        .min(1, "Page must be at least 1.")
        .default(1),

    pageSize: z.coerce
        .number()
        .int()
        .min(1, "Page size must be at least 1.")
        .max(100, "Page size must not exceed 100.")
        .default(20),

    sortBy: z
        .enum([
            "createdAt",
            "updatedAt",
            "workOrderNumber",
            "title",
            "status",
            "priority",
            "estimatedDuration",
            "startedAt",
            "completedAt",
        ])
        .optional()
        .default("createdAt"),

    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type TechnicianWorkOrderQueryInput = z.input<typeof technicianWorkOrderQuerySchema>;
export type TechnicianWorkOrderQueryOutput = z.output<typeof technicianWorkOrderQuerySchema>;

export interface TechnicianWorkOrderListResult {
    items: WorkOrderReadModel[];
    pagination: PaginationMetadata;
}

/**
 * Validation schema for starting technician travel.
 */
export const startTravelSchema = z.object({
    notes: z.string().trim().optional().nullable(),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export type StartTravelInput = z.infer<typeof startTravelSchema>;

/**
 * Validation schema for starting on-site work.
 */
export const startWorkOrderSchema = z.object({
    notes: z.string().trim().optional().nullable(),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export type StartWorkOrderInput = z.infer<typeof startWorkOrderSchema>;

/**
 * Validation schema for holding a work order.
 */
export const holdWorkOrderSchema = z.object({
    holdReason: z.string().trim().min(1, "Hold reason is required."),
    notes: z.string().trim().optional().nullable(),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export type HoldWorkOrderInput = z.infer<typeof holdWorkOrderSchema>;

/**
 * Validation schema for resuming a work order.
 */
export const resumeWorkOrderSchema = z.object({
    notes: z.string().trim().optional().nullable(),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export type ResumeWorkOrderInput = z.infer<typeof resumeWorkOrderSchema>;

/**
 * Canonical read model for TechnicianTimeEntry.
 */
export interface TechnicianTimeEntryReadModel {
    id: string;
    workspaceId: string;
    technicianProfileId: string;
    workOrderId: string;
    appointmentId: string | null;
    entryType: TimeEntryType;
    status: TimeEntryStatus;
    startedAt: Date;
    endedAt: Date | null;
    durationMinutes: number | null;
    notes: string | null;
    metadata: Record<string, any> | null;
    createdByMemberId: string;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Maps a raw Prisma TechnicianTimeEntry model to canonical TechnicianTimeEntryReadModel.
 */
export function toTechnicianTimeEntryReadModel(
    entry: TechnicianTimeEntry
): TechnicianTimeEntryReadModel {
    return {
        id: entry.id,
        workspaceId: entry.workspaceId,
        technicianProfileId: entry.technicianProfileId,
        workOrderId: entry.workOrderId,
        appointmentId: entry.appointmentId,
        entryType: entry.entryType,
        status: entry.status,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        durationMinutes: entry.durationMinutes,
        notes: entry.notes,
        metadata: (entry.metadata as Record<string, any> | null) ?? null,
        createdByMemberId: entry.createdByMemberId,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
    };
}
