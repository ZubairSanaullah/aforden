import type { AssetDetailViewModel, AssetListItem } from "@/lib/services/asset/asset.types";

/**
 * Canonical external representation of an Asset / Equipment resource.
 *
 * Excluded Internal Fields:
 * - workspaceId (tenant boundary security)
 * - notes (internal private notes)
 * - metadata (internal system JSON dictionary)
 * - purchaseCost (internal procurement / financial accounting cost - guarded from operational API scopes)
 * - relational objects (customer, location, category, workOrders) -> projected as IDs
 */
export interface PublicAssetDto {
    id: string;
    assetNumber: string;
    name: string;
    status: string;
    customerId: string | null;
    locationId: string | null;
    categoryId: string | null;
    manufacturer: string | null;
    modelNumber: string | null;
    serialNumber: string | null;
    subLocationNotes: string | null;
    installationDate: string | null;
    warrantyExpiresAt: string | null;
    purchaseDate: string | null;
    tags: string[];
    decommissionedAt: string | null;
    retiredAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export const APPROVED_PUBLIC_ASSET_DTO_KEYS = [
    "id",
    "assetNumber",
    "name",
    "status",
    "customerId",
    "locationId",
    "categoryId",
    "manufacturer",
    "modelNumber",
    "serialNumber",
    "subLocationNotes",
    "installationDate",
    "warrantyExpiresAt",
    "purchaseDate",
    "tags",
    "decommissionedAt",
    "retiredAt",
    "createdAt",
    "updatedAt",
] as const;

/**
 * Projects internal domain Asset models to public API DTO.
 */
export function toPublicAssetDto(
    asset: AssetDetailViewModel | AssetListItem | any,
): PublicAssetDto {
    return {
        id: asset.id,
        assetNumber: asset.assetNumber,
        name: asset.name,
        status: asset.status,
        customerId: asset.customer?.id ?? asset.customerId ?? null,
        locationId: asset.location?.id ?? asset.locationId ?? null,
        categoryId: asset.category?.id ?? asset.categoryId ?? null,
        manufacturer: asset.manufacturer ?? null,
        modelNumber: asset.modelNumber ?? null,
        serialNumber: asset.serialNumber ?? null,
        subLocationNotes: asset.subLocationNotes ?? null,
        installationDate: asset.installationDate
            ? new Date(asset.installationDate).toISOString()
            : null,
        warrantyExpiresAt: asset.warrantyExpiresAt
            ? new Date(asset.warrantyExpiresAt).toISOString()
            : null,
        purchaseDate: asset.purchaseDate
            ? new Date(asset.purchaseDate).toISOString()
            : null,
        tags: Array.isArray(asset.tags) ? asset.tags : [],
        decommissionedAt: asset.decommissionedAt
            ? new Date(asset.decommissionedAt).toISOString()
            : null,
        retiredAt: asset.retiredAt
            ? new Date(asset.retiredAt).toISOString()
            : null,
        createdAt: new Date(asset.createdAt).toISOString(),
        updatedAt: new Date(asset.updatedAt).toISOString(),
    };
}
