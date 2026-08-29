import type { WorkOrderReadModel } from "@/lib/services/workOrder";

/**
 * Canonical Public API DTO for WorkOrder resource.
 *
 * Excluded Internal Fields:
 * - workspaceId: Sourced and verified from authenticated context; excluded to prevent internal partition leakage.
 * - internalNotes: Operational notes reserved for internal web dashboard dispatchers/technicians.
 * - customerNumber, customerName, locationName, locationAddress, workTypeName, workTypeCode:
 *   Denormalized joined UI fields from internal read projection; REST contract exposes normalized entity foreign keys.
 * - Soft-delete flags / internal database tombstone attributes.
 */
export interface PublicWorkOrderDto {
    id: string;
    workOrderNumber: string;
    status: string;
    priority: string;
    title: string;
    description: string | null;
    customerId: string;
    locationId: string;
    workTypeId: string;
    assignedTechnicianId: string | null;
    assetId: string | null;
    estimatedDuration: number | null;
    holdReason: string | null;
    cancellationReason: string | null;
    startedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export function toPublicWorkOrderDto(
    model: WorkOrderReadModel,
): PublicWorkOrderDto {
    return {
        id: model.id,
        workOrderNumber: model.workOrderNumber,
        status: model.status,
        priority: model.priority,
        title: model.title,
        description: model.description ?? null,
        customerId: model.customerId,
        locationId: model.locationId,
        workTypeId: model.workTypeId,
        assignedTechnicianId: model.assignedTechnicianId ?? null,
        assetId: model.assetId ?? null,
        estimatedDuration: model.estimatedDuration ?? null,
        holdReason: model.holdReason ?? null,
        cancellationReason: model.cancellationReason ?? null,
        startedAt: model.startedAt ? model.startedAt.toISOString() : null,
        completedAt: model.completedAt ? model.completedAt.toISOString() : null,
        cancelledAt: model.cancelledAt ? model.cancelledAt.toISOString() : null,
        createdAt: model.createdAt.toISOString(),
        updatedAt: model.updatedAt.toISOString(),
    };
}
