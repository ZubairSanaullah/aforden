import type { PaginationMetadata } from "@/lib/services/serviceCatalog/serviceCatalog.types";

export type { PaginationMetadata };

/**
 * Canonical detailed view model for single InventoryBalance presentation.
 * Follows the Asset / Part precedent of serializing Decimal fields as numbers.
 * The quantityAvailable field is derived dynamically: quantityOnHand - quantityReserved.
 *
 * For synthetic zero-balance representations (when no DB row exists yet for a valid part-location pair),
 * id, createdAt, and updatedAt are null.
 */
export interface InventoryBalanceDetailViewModel {
    id: string | null;
    workspaceId: string;
    partId: string;
    locationId: string;
    quantityOnHand: number;
    quantityReserved: number;
    quantityAvailable: number;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export type InventoryBalanceOperationalReadModel = InventoryBalanceDetailViewModel;
export type InventoryBalanceListItem = InventoryBalanceDetailViewModel;

/**
 * Paginated result container for InventoryBalance list queries.
 */
export interface InventoryBalanceListResult {
    items: InventoryBalanceDetailViewModel[];
    pagination: PaginationMetadata;
}

// ---------------------------------------------------------------------------
// Query Input DTOs
// ---------------------------------------------------------------------------

export type InventoryBalanceSortField =
    | "quantityOnHand"
    | "quantityReserved"
    | "createdAt"
    | "updatedAt";

export interface GetInventoryBalancesQueryInput {
    partId?: string;
    locationId?: string;
    page?: number;
    pageSize?: number;
    sortBy?: InventoryBalanceSortField;
    sortOrder?: "asc" | "desc";
}
