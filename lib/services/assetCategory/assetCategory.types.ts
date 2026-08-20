import type { AssetCategory, AssetCategoryStatus } from "@/generated/prisma/client";
import type { PaginationMetadata } from "@/lib/services/serviceCatalog/serviceCatalog.types";

export type { PaginationMetadata };

/**
 * Operational AssetCategory read model projection.
 */
export interface AssetCategoryViewModel {
    id: string;
    workspaceId: string;
    name: string;
    code: string | null;
    description: string | null;
    status: AssetCategoryStatus;
    sortOrder: number;
    assetsCount?: number;
    createdAt: Date;
    updatedAt: Date;
}

export type AssetCategoryOperationalReadModel = AssetCategoryViewModel;

/**
 * Result container for AssetCategory queries.
 */
export interface AssetCategoryListResult {
    items: AssetCategoryViewModel[];
    pagination?: PaginationMetadata;
}

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface CreateAssetCategoryInput {
    name: string;
    code?: string | null;
    description?: string | null;
    status?: AssetCategoryStatus;
    sortOrder?: number;
}

export interface UpdateAssetCategoryInput {
    name?: string;
    code?: string | null;
    description?: string | null;
    status?: AssetCategoryStatus;
    sortOrder?: number;
}

export interface GetAssetCategoriesQueryInput {
    status?: AssetCategoryStatus | "ALL";
    search?: string;
    page?: number;
    pageSize?: number;
    sortBy?: "name" | "code" | "sortOrder" | "createdAt" | "updatedAt";
    sortOrder?: "asc" | "desc";
}
