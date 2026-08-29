import type { InventoryBalanceDetailViewModel, InventoryBalanceListItem } from "@/lib/services/inventory/balance/inventoryBalance.types";

/**
 * Canonical external representation of an Inventory Balance resource.
 *
 * Privacy & Security Invariants:
 * - Excludes `workspaceId` (Tenant boundary security invariant)
 */
export interface PublicInventoryBalanceDto {
    id: string | null;
    partId: string;
    locationId: string;
    quantityOnHand: number;
    quantityReserved: number;
    quantityAvailable: number;
    updatedAt: string | null;
}

export const APPROVED_PUBLIC_INVENTORY_DTO_KEYS = [
    "id",
    "partId",
    "locationId",
    "quantityOnHand",
    "quantityReserved",
    "quantityAvailable",
    "updatedAt",
] as const;

/**
 * Maps an internal InventoryBalance read model to the canonical PublicInventoryBalanceDto.
 */
export function toPublicInventoryBalanceDto(
    item: InventoryBalanceDetailViewModel | InventoryBalanceListItem | any,
): PublicInventoryBalanceDto {
    return {
        id: item.id ?? null,
        partId: item.partId,
        locationId: item.locationId,
        quantityOnHand: Number(item.quantityOnHand),
        quantityReserved: Number(item.quantityReserved),
        quantityAvailable: Number(item.quantityAvailable),
        updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null,
    };
}
