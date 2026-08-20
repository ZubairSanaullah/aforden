import { z } from "zod";

export const WORK_ORDER_STATUSES = [
    "OPEN",
    "ASSIGNED",
    "IN_PROGRESS",
    "ON_HOLD",
    "COMPLETED",
    "CANCELLED",
] as const;

export type WorkOrderStatusType = (typeof WORK_ORDER_STATUSES)[number];

export const workOrderStatusSchema = z.enum(WORK_ORDER_STATUSES, {
    error: "Status must be one of: OPEN, ASSIGNED, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED.",
});

export const WORK_ORDER_PRIORITIES = [
    "LOW",
    "MEDIUM",
    "HIGH",
    "URGENT",
] as const;

export type WorkOrderPriorityType = (typeof WORK_ORDER_PRIORITIES)[number];

export const workOrderPrioritySchema = z.enum(WORK_ORDER_PRIORITIES, {
    error: "Priority must be one of: LOW, MEDIUM, HIGH, URGENT.",
});

/**
 * Payload schema for creating a new WorkOrder.
 *
 * Locked Invariants (Phase 1.6.1 §3):
 * - Customer, ServiceLocation, and WorkType ID references are required.
 * - Title is required.
 * - Priority defaults to MEDIUM if omitted.
 * - Snapshot fields (workTypeName, workTypeCode, estimatedDuration) are strictly forbidden in client payload.
 * - Lifecycle/Assignment fields (status, assignedTechnicianId, timestamps, cancellation/hold reasons) are forbidden.
 * - .strict() rejects unknown/unexpected fields.
 */
export const createWorkOrderSchema = z
    .object({
        customerId: z
            .string()
            .trim()
            .min(1, "Customer ID is required."),

        locationId: z
            .string()
            .trim()
            .min(1, "Location ID is required."),

        workTypeId: z
            .string()
            .trim()
            .min(1, "Work type ID is required."),

        assetId: z
            .string()
            .trim()
            .min(1, "Asset ID must not be empty.")
            .nullable()
            .optional(),

        title: z
            .string()
            .trim()
            .min(1, "Title must not be empty.")
            .max(200, "Title must contain less than 200 characters."),

        priority: workOrderPrioritySchema
            .default("MEDIUM"),

        description: z
            .string()
            .trim()
            .max(4000, "Description must contain less than 4000 characters.")
            .nullable()
            .optional(),

        internalNotes: z
            .string()
            .trim()
            .max(4000, "Internal notes must contain less than 4000 characters.")
            .nullable()
            .optional(),
    })
    .strict();

export const CreateWorkOrderSchema = createWorkOrderSchema;
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

/**
 * Payload schema for updating mutable metadata on an existing WorkOrder.
 *
 * Locked Invariants (Phase 1.6.1 §3 & §5):
 * - All fields are optional (partial update).
 * - Only title, priority, description, internalNotes, and assetId are mutable.
 * - Snapshot, lifecycle, and assignment fields are strictly excluded.
 * - .strict() rejects unknown/unexpected fields.
 */
export const updateWorkOrderSchema = z
    .object({
        assetId: z
            .string()
            .trim()
            .min(1, "Asset ID must not be empty.")
            .nullable()
            .optional(),

        title: z
            .string()
            .trim()
            .min(1, "Title must not be empty.")
            .max(200, "Title must contain less than 200 characters.")
            .optional(),

        priority: workOrderPrioritySchema.optional(),

        description: z
            .string()
            .trim()
            .max(4000, "Description must contain less than 4000 characters.")
            .nullable()
            .optional(),

        internalNotes: z
            .string()
            .trim()
            .max(4000, "Internal notes must contain less than 4000 characters.")
            .nullable()
            .optional(),
    })
    .strict();

export const UpdateWorkOrderSchema = updateWorkOrderSchema;
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;

/**
 * Payload schema for assigning or reassigning a Technician to a WorkOrder.
 *
 * Endpoint: POST /api/work-orders/[workOrderId]/assign
 */
export const assignWorkOrderSchema = z
    .object({
        technicianId: z
            .string()
            .trim()
            .min(1, "Technician ID is required."),
    })
    .strict();

export const AssignWorkOrderSchema = assignWorkOrderSchema;
export type AssignWorkOrderInput = z.infer<typeof assignWorkOrderSchema>;

/**
 * Payload schema for transitioning the operational lifecycle status of a WorkOrder.
 *
 * Endpoint: PATCH /api/work-orders/[workOrderId]/status
 *
 * Conditional Requirements (Phase 1.6.1 §4.2):
 * - toStatus = ON_HOLD requires holdReason (non-empty string).
 * - toStatus = CANCELLED requires cancellationReason (non-empty string).
 */
export const statusTransitionSchema = z
    .object({
        toStatus: workOrderStatusSchema,

        holdReason: z
            .string()
            .trim()
            .max(2000, "Hold reason cannot exceed 2000 characters.")
            .nullable()
            .optional(),

        cancellationReason: z
            .string()
            .trim()
            .max(2000, "Cancellation reason cannot exceed 2000 characters.")
            .nullable()
            .optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.toStatus === "ON_HOLD") {
            if (!data.holdReason || data.holdReason.trim().length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Hold reason is required when transitioning to ON_HOLD.",
                    path: ["holdReason"],
                });
            }
        }

        if (data.toStatus === "CANCELLED") {
            if (!data.cancellationReason || data.cancellationReason.trim().length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Cancellation reason is required when transitioning to CANCELLED.",
                    path: ["cancellationReason"],
                });
            }
        }
    });

export const StatusTransitionSchema = statusTransitionSchema;
export type StatusTransitionInput = z.infer<typeof statusTransitionSchema>;
export const updateWorkOrderStatusSchema = statusTransitionSchema;
export const changeWorkOrderStatusSchema = statusTransitionSchema;
export type UpdateWorkOrderStatusInput = StatusTransitionInput;
export type ChangeWorkOrderStatusInput = StatusTransitionInput;


/**
 * Query parameter schema for WorkOrder directory list, search, filter, and pagination.
 *
 * Endpoint: GET /api/work-orders
 */
export const workOrderQuerySchema = z.object({
    search: z
        .string()
        .trim()
        .max(100, "Search query must contain less than 100 characters.")
        .optional(),

    customerId: z
        .string()
        .trim()
        .min(1, "Customer ID must not be empty.")
        .optional(),

    locationId: z
        .string()
        .trim()
        .min(1, "Location ID must not be empty.")
        .optional(),

    workTypeId: z
        .string()
        .trim()
        .min(1, "Work type ID must not be empty.")
        .optional(),

    assignedTechnicianId: z
        .string()
        .trim()
        .min(1, "Technician ID must not be empty.")
        .optional(),

    status: workOrderStatusSchema.optional(),

    priority: workOrderPrioritySchema.optional(),

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
        ])
        .optional()
        .default("createdAt"),

    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const WorkOrderDirectoryQuerySchema = workOrderQuerySchema;
export const getWorkOrdersQuerySchema = workOrderQuerySchema;

export type WorkOrderQueryInput = z.input<typeof workOrderQuerySchema>;
export type WorkOrderQueryOutput = z.output<typeof workOrderQuerySchema>;
export type GetWorkOrdersQueryInput = WorkOrderQueryInput;
export type GetWorkOrdersQueryOutput = WorkOrderQueryOutput;
export type WorkOrderDirectoryQueryInput = WorkOrderQueryInput;
export type WorkOrderDirectoryQueryOutput = WorkOrderQueryOutput;

export const workOrderHistoryEventTypeSchema = z.enum([
    "CREATED",
    "UPDATED",
    "STATUS_CHANGED",
    "ASSIGNED",
    "REASSIGNED",
    "UNASSIGNED",
    "DELETED",
]);

export const workOrderHistoryQuerySchema = z.object({
    eventType: workOrderHistoryEventTypeSchema.optional(),

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

    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type WorkOrderHistoryQueryInput = z.input<typeof workOrderHistoryQuerySchema>;
export type WorkOrderHistoryQueryOutput = z.output<typeof workOrderHistoryQuerySchema>;
