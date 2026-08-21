import type {
    ScheduleStatus,
    DispatchStatus,
    ScheduleHistoryEventType,
    WorkOrderStatus,
    WorkOrderPriority,
} from "@/generated/prisma/client";

export type {
    ScheduleStatus,
    DispatchStatus,
    ScheduleHistoryEventType,
};

// Re-export canonical Zod-schema-inferred input types (§12 Step 3)
export type {
    CreateScheduleInput,
    CreateScheduleAppointmentInput,
    RescheduleScheduleInput,
    RescheduleAppointmentInput,
    CancelScheduleInput,
    CancelAppointmentInput,
    UpdateScheduleInput,
    UpdateScheduleAppointmentInput,
    DispatchAppointmentInput,
    UndispatchAppointmentInput,
    AcknowledgeDispatchInput,
    ListSchedulesQueryInput,
    GetTechnicianScheduleQueryInput,
    GetAppointmentHistoryQueryInput,
} from "./schedule.schemas";

/**
 * Standardized Pagination Metadata shape matching platform convention.
 */
export interface PaginationMetadata {
    page: number;
    limit: number;
    pageSize?: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

/**
 * Authoritative Canonical Read Model for ScheduleAppointment (§14).
 *
 * Denormalizes parent WorkOrder, Customer, Location, and Technician details
 * to provide a high-performance projection for calendar grids, Gantt timelines,
 * and dispatch boards with zero N+1 database queries.
 */
export interface ScheduleAppointmentReadModel {
    id: string;
    workspaceId: string;
    appointmentNumber: string;

    // Parent WorkOrder Information
    workOrderId: string;
    workOrderNumber: string;
    workOrderTitle: string;
    workOrderStatus: WorkOrderStatus | string;
    workOrderPriority: WorkOrderPriority | string;

    // Customer & Service Location Projections
    customerId: string;
    customerName: string;
    customerNumber: string | null;

    locationId: string;
    locationName: string;
    locationAddress: string;
    locationLatitude: number | null;
    locationLongitude: number | null;

    // Associated Asset (if linked to WorkOrder)
    assetId: string | null;
    assetName: string | null;
    assetNumber: string | null;

    // Assigned Technician Information
    technicianId: string;
    technicianName: string;
    technicianEmployeeNumber: string | null;

    // Calendar Interval & Timezone
    scheduledStart: Date;
    scheduledEnd: Date;
    durationMinutes: number;
    timezone: string;

    // Lifecycle & Dispatch States
    status: ScheduleStatus;
    dispatchStatus: DispatchStatus;

    // Dispatch Tracking Metadata
    dispatchedAt: Date | null;
    dispatchedByMemberId: string | null;
    dispatchedByName: string | null;

    undispatchedAt: Date | null;
    undispatchedByMemberId: string | null;

    fieldExecutionStartedAt: Date | null;

    // Notes & Explanations
    cancellationReason: string | null;
    notes: string | null;
    metadata: Record<string, any> | null;

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

export type ScheduleAppointmentOperationalReadModel = ScheduleAppointmentReadModel;

export interface ScheduleAppointmentListResult {
    items: ScheduleAppointmentReadModel[];
    pagination: PaginationMetadata;
}

/**
 * Historical Audit Read Model for ScheduleAppointmentHistory (§4.2, §15).
 */
export interface ScheduleAppointmentHistoryReadModel {
    id: string;
    workspaceId: string;
    appointmentId: string;
    eventType: ScheduleHistoryEventType;

    actorMemberId: string | null;
    actorName: string | null;

    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    metadata: Record<string, any> | null;

    createdAt: Date;
}

export interface ScheduleAppointmentHistoryListResult {
    items: ScheduleAppointmentHistoryReadModel[];
    pagination: PaginationMetadata;
}

/**
 * Conflict item projection for conflict detection evaluation (§7).
 */
export interface ScheduleConflictItem {
    id: string;
    appointmentNumber: string;
    technicianId: string;
    technicianName?: string;
    workOrderId: string;
    workOrderNumber?: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    status: ScheduleStatus;
}
