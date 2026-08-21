import type {
    Asset,
    AssetStatus,
    AssetHistoryEventType,
    MembershipRole,
} from "@/generated/prisma/client";
import type { PaginationMetadata } from "@/lib/services/serviceCatalog/serviceCatalog.types";

export type { PaginationMetadata };

/**
 * Summary view of a Customer referenced by an Asset.
 */
export interface AssetCustomerSummary {
    id: string;
    customerNumber: string | null;
    name: string;
}

/**
 * Summary view of a ServiceLocation referenced by an Asset.
 */
export interface AssetLocationSummary {
    id: string;
    name: string;
    addressLine1: string;
    city: string;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
}

/**
 * Summary view of an AssetCategory referenced by an Asset.
 */
export interface AssetCategorySummary {
    id: string;
    name: string;
    code: string | null;
}

/**
 * Canonical detailed view model for single Asset presentation (Phase 1.7.1 Section 15.1).
 * Features nested summaries for customer, location, and category.
 */
export interface AssetDetailViewModel {
    id: string;
    workspaceId: string;
    assetNumber: string;
    name: string;
    status: AssetStatus;

    manufacturer: string | null;
    modelNumber: string | null;
    serialNumber: string | null;
    subLocationNotes: string | null;

    installationDate: Date | null;
    warrantyExpiresAt: Date | null;
    purchaseDate: Date | null;
    purchaseCost: number | string | null;
    notes: string | null;
    tags: string[];
    metadata: Record<string, any> | null;

    customer: AssetCustomerSummary | null;
    location: AssetLocationSummary | null;
    category: AssetCategorySummary | null;

    createdAt: Date;
    updatedAt: Date;
    decommissionedAt: Date | null;
    retiredAt: Date | null;
}

/**
 * Lighter-weight list item projection for directory and multi-item queries.
 */
export interface AssetListItem {
    id: string;
    workspaceId: string;
    assetNumber: string;
    name: string;
    status: AssetStatus;

    manufacturer: string | null;
    modelNumber: string | null;
    serialNumber: string | null;
    subLocationNotes: string | null;

    tags: string[];

    customerId: string | null;
    customerName: string | null;
    customerNumber: string | null;

    locationId: string | null;
    locationName: string | null;

    categoryId: string | null;
    categoryName: string | null;
    categoryCode: string | null;

    warrantyExpiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export type AssetOperationalReadModel = AssetListItem;

/**
 * Paginated result container for Asset directory lists.
 */
export interface AssetListResult {
    items: AssetListItem[];
    pagination: PaginationMetadata;
}

/**
 * Operational metrics and aggregate counts for the Asset dashboard.
 */
export interface AssetOperationalSummary {
    workspaceId: string;
    totalAssets: number;
    operationalAssets: number;
    degradedAssets: number;
    outOfServiceAssets: number;
    criticalOutOfServiceAssets: number;
    inStorageAssets: number;
    decommissionedAssets: number;
    retiredAssets: number;
    byCategory: Array<{
        categoryId: string | null;
        categoryName: string;
        count: number;
    }>;
}

/**
 * Summary view of an Actor (User) referenced by an AssetHistory record.
 */
export interface AssetActorSummary {
    id: string | null;
    name: string;
    email?: string | null;
}

/**
 * Read model projection for immutable audit ledger entries.
 */
export interface AssetHistoryReadModel {
    id: string;
    workspaceId: string;
    assetId: string;
    eventType: AssetHistoryEventType;
    actorUserId: string | null;
    actorRole: MembershipRole;
    actorName?: string;
    actor?: AssetActorSummary | null;
    reason: string | null;
    metadata: Record<string, any> | null;
    createdAt: Date;
}

/**
 * Paginated result container for Asset audit history.
 */
export interface AssetHistoryListResult {
    items: AssetHistoryReadModel[];
    pagination: PaginationMetadata;
}

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface CreateAssetInput {
    name: string;
    assetNumber?: string;
    customerId?: string | null;
    locationId?: string | null;
    categoryId?: string | null;
    manufacturer?: string | null;
    modelNumber?: string | null;
    serialNumber?: string | null;
    status?: AssetStatus;
    subLocationNotes?: string | null;
    installationDate?: Date | string | null;
    warrantyExpiresAt?: Date | string | null;
    purchaseDate?: Date | string | null;
    purchaseCost?: number | string | null;
    notes?: string | null;
    tags?: string[];
    metadata?: Record<string, any> | null;
}

export interface UpdateAssetInput {
    name?: string;
    assetNumber?: string;
    categoryId?: string | null;
    manufacturer?: string | null;
    modelNumber?: string | null;
    serialNumber?: string | null;
    subLocationNotes?: string | null;
    installationDate?: Date | string | null;
    warrantyExpiresAt?: Date | string | null;
    purchaseDate?: Date | string | null;
    purchaseCost?: number | string | null;
    notes?: string | null;
    tags?: string[];
    metadata?: Record<string, any> | null;
}

export interface TransitionAssetStatusInput {
    fromStatus?: AssetStatus;
    toStatus: AssetStatus;
    statusReason?: string | null;
}

export interface TransferAssetLocationInput {
    locationId: string;
    subLocationNotes?: string | null;
    transferReason: string;
}

export interface TransferAssetOwnershipInput {
    customerId: string;
    locationId?: string | null;
    subLocationNotes?: string | null;
    transferReason: string;
}

export type AssetSortField =
    | "createdAt"
    | "updatedAt"
    | "name"
    | "assetNumber"
    | "serialNumber"
    | "status"
    | "manufacturer";

export interface GetAssetsQueryInput {
    search?: string;
    status?: AssetStatus;
    customerId?: string;
    locationId?: string;
    categoryId?: string;
    tags?: string[] | string;
    manufacturer?: string;
    page?: number;
    pageSize?: number;
    sortBy?: AssetSortField;
    sortOrder?: "asc" | "desc";
}
