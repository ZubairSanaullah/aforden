import type {
    WorkOrder,
    WorkOrderStatus,
    WorkOrderPriority,
} from "@/generated/prisma/client";
import type { PaginationMetadata } from "@/lib/services/serviceCatalog/serviceCatalog.types";

export type { PaginationMetadata };

/**
 * Operational WorkOrder read model projection.
 */
export interface WorkOrderReadModel {
    id: string;
    workspaceId: string;
    workOrderNumber: string;

    customerId: string;
    customerName: string;
    customerNumber: string | null;

    locationId: string;
    locationName: string;
    locationAddress: string;

    workTypeId: string;
    workTypeName: string;
    workTypeCode: string | null;
    estimatedDuration: number | null;

    assignedTechnicianId: string | null;
    assetId: string | null;

    status: WorkOrderStatus;
    priority: WorkOrderPriority;

    title: string;
    description: string | null;
    internalNotes: string | null;
    holdReason: string | null;
    cancellationReason: string | null;

    startedAt: Date | null;
    completedAt: Date | null;
    cancelledAt: Date | null;

    createdAt: Date;
    updatedAt: Date;
}

export type WorkOrderOperationalReadModel = WorkOrderReadModel;

export interface WorkOrderListResult {
    items: WorkOrderReadModel[];
    pagination: PaginationMetadata;
}

export type WorkOrderHistoryEventType =
    | "CREATED"
    | "UPDATED"
    | "STATUS_CHANGED"
    | "ASSIGNED"
    | "REASSIGNED"
    | "UNASSIGNED"
    | "DELETED";

export interface WorkOrderHistoryReadModel {
    id: string;
    workspaceId: string;
    workOrderId: string;
    eventType: WorkOrderHistoryEventType;

    actorMemberId: string | null;
    actorName: string | null;

    field: string | null;
    oldValue: string | null;
    newValue: string | null;

    metadata: Record<string, any> | null;

    createdAt: Date;
}

export interface WorkOrderHistoryListResult {
    items: WorkOrderHistoryReadModel[];
    pagination: PaginationMetadata;
}
