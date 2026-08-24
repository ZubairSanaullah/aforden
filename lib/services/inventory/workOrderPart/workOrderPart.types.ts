import type { PartUnitOfMeasure } from "@/generated/prisma/client";

/**
 * Detailed presentation model for WorkOrderPart consumption records.
 * Decimal values are projected to numbers.
 * Includes ledger-derived netQuantityConsumed (Section 7.3).
 */
export interface WorkOrderPartDetailViewModel {
    id: string;
    workspaceId: string;
    workOrderId: string;
    partId: string;
    locationId: string;
    quantity: number;
    unitCostAtTimeOfUse: number;
    partName: string;
    partSku: string | null;
    unitOfMeasure: PartUnitOfMeasure;
    consumedByMemberId: string | null;
    consumedAt: Date;
    notes: string | null;
    createdAt: Date;
    netQuantityConsumed: number;
}

export interface GetWorkOrderPartsFilter {
    workOrderId?: string;
    partId?: string;
    locationId?: string;
    page?: number;
    limit?: number;
}

export interface PaginatedWorkOrderPartsResult {
    items: WorkOrderPartDetailViewModel[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}
