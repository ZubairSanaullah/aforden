import type {
    PartStatus,
    PartUnitOfMeasure,
} from "@/generated/prisma/client";
import type { PaginationMetadata } from "@/lib/services/serviceCatalog/serviceCatalog.types";

export type { PaginationMetadata };

/**
 * Canonical detailed view model for single Part presentation.
 * Follows the Asset / ServiceCatalog precedent of serializing Decimal fields as numbers (or null).
 */
export interface PartDetailViewModel {
    id: string;
    workspaceId: string;
    name: string;
    sku: string | null;
    description: string | null;
    unitOfMeasure: PartUnitOfMeasure;
    unitCost: number | null;
    minimumStockLevel: number | null;
    status: PartStatus;
    createdAt: Date;
    updatedAt: Date;
}

export type PartOperationalReadModel = PartDetailViewModel;
export type PartListItem = PartDetailViewModel;

/**
 * Paginated result container for Part catalog list queries.
 */
export interface PartListResult {
    items: PartDetailViewModel[];
    pagination: PaginationMetadata;
}

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface CreatePartInput {
    name: string;
    sku?: string | null;
    description?: string | null;
    unitOfMeasure?: PartUnitOfMeasure;
    unitCost?: number | null;
    minimumStockLevel?: number | null;
}

export interface UpdatePartInput {
    name?: string;
    sku?: string | null;
    description?: string | null;
    unitOfMeasure?: PartUnitOfMeasure;
    unitCost?: number | null;
    minimumStockLevel?: number | null;
}

export interface TransitionPartStatusInput {
    status: PartStatus;
}

export type PartSortField =
    | "name"
    | "sku"
    | "status"
    | "unitOfMeasure"
    | "unitCost"
    | "minimumStockLevel"
    | "createdAt"
    | "updatedAt";

export interface GetPartsQueryInput {
    search?: string;
    status?: PartStatus;
    unitOfMeasure?: PartUnitOfMeasure;
    page?: number;
    pageSize?: number;
    sortBy?: PartSortField;
    sortOrder?: "asc" | "desc";
}
