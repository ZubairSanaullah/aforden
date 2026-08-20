import type { ServiceCatalog, ServiceCatalogStatus } from "@/generated/prisma/client";
import type {
    ServiceCatalogQueryInput,
    ServiceCatalogQueryOutput,
} from "@/lib/validations/serviceCatalog";

export interface PaginationMetadata {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

/**
 * Operational ServiceCatalog read model projection.
 */
export interface ServiceCatalogOperationalReadModel {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    status: ServiceCatalogStatus;
    sortOrder: number;
    workTypesCount: number;
    activeWorkTypesCount: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface ServiceCatalogListResult {
    items: ServiceCatalogOperationalReadModel[];
    pagination: PaginationMetadata;
}

export interface ServiceCatalogOperationalSummary {
    workspaceId: string;
    totalCatalogs: number;
    activeCatalogs: number;
    inactiveCatalogs: number;
    totalWorkTypes: number;
    activeWorkTypes: number;
}
