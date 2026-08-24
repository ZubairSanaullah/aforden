import type {
    InventoryLocationStatus,
    InventoryLocationType,
} from "@/generated/prisma/client";
import type { PaginationMetadata } from "@/lib/services/serviceCatalog/serviceCatalog.types";

export type { PaginationMetadata };

/**
 * Canonical detailed view model for single InventoryLocation presentation.
 */
export interface InventoryLocationDetailViewModel {
    id: string;
    workspaceId: string;
    name: string;
    code: string | null;
    locationType: InventoryLocationType;
    technicianProfileId: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    notes: string | null;
    status: InventoryLocationStatus;
    createdAt: Date;
    updatedAt: Date;
}

export type InventoryLocationOperationalReadModel = InventoryLocationDetailViewModel;
export type InventoryLocationListItem = InventoryLocationDetailViewModel;

/**
 * Paginated result container for InventoryLocation queries.
 */
export interface InventoryLocationListResult {
    items: InventoryLocationDetailViewModel[];
    pagination: PaginationMetadata;
}

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface CreateInventoryLocationInput {
    name: string;
    code?: string | null;
    locationType?: InventoryLocationType;
    technicianProfileId?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
    notes?: string | null;
}

export interface UpdateInventoryLocationInput {
    name?: string;
    code?: string | null;
    locationType?: InventoryLocationType;
    technicianProfileId?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
    notes?: string | null;
}

export interface TransitionInventoryLocationStatusInput {
    status: InventoryLocationStatus;
}

export type InventoryLocationSortField =
    | "name"
    | "code"
    | "locationType"
    | "status"
    | "createdAt"
    | "updatedAt";

export interface GetInventoryLocationsQueryInput {
    search?: string;
    status?: InventoryLocationStatus;
    locationType?: InventoryLocationType;
    technicianProfileId?: string;
    page?: number;
    pageSize?: number;
    sortBy?: InventoryLocationSortField;
    sortOrder?: "asc" | "desc";
}
