import type { ServiceCatalogStatus, WorkType, WorkTypeStatus } from "@/generated/prisma/client";
import type { PaginationMetadata } from "@/lib/services/serviceCatalog/serviceCatalog.types";
import type {
    WorkTypeQueryInput,
    WorkTypeQueryOutput,
} from "@/lib/validations/workType";

export type { PaginationMetadata };

/**
 * Operational WorkType read model projection.
 */
export interface WorkTypeOperationalReadModel {
    id: string;
    workspaceId: string;
    catalogId: string;
    catalogName: string;
    catalogStatus: ServiceCatalogStatus;
    name: string;
    code: string | null;
    description: string | null;
    estimatedDuration: number | null;
    status: WorkTypeStatus;
    sortOrder: number;
    isAvailableForWorkOrder: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface WorkTypeListResult {
    items: WorkTypeOperationalReadModel[];
    pagination: PaginationMetadata;
}

export interface WorkTypeOperationalSummary {
    workspaceId: string;
    totalWorkTypes: number;
    activeWorkTypes: number;
    inactiveWorkTypes: number;
    availableWorkTypes: number;
    unavailableWorkTypes: number;
    totalCatalogs: number;
}

/**
 * Minimum operational projection required by downstream WorkOrder (Phase 1.6) creation.
 */
export interface WorkTypeWorkOrderConsumptionModel {
    workTypeId: string;
    workspaceId: string;
    catalogId: string;
    name: string;
    code: string | null;
    estimatedDuration: number | null;
    isAvailableForWorkOrder: boolean;
}

