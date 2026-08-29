import type { PartDetailViewModel, PartListItem } from "@/lib/services/inventory/part/part.types";

/**
 * Canonical external representation of a Part resource.
 *
 * Privacy & Security Invariants:
 * - Excludes `unitCost` (Wholesale purchase cost / COGS - confidential internal financial data)
 * - Excludes `minimumStockLevel` (Internal supply-chain threshold / reorder planning metric)
 * - Excludes `workspaceId` (Tenant boundary security invariant)
 */
export interface PublicPartDto {
    id: string;
    name: string;
    sku: string | null;
    description: string | null;
    unitOfMeasure: string;
    status: string;
    createdAt: string;
    updatedAt: string;
}

export const APPROVED_PUBLIC_PART_DTO_KEYS = [
    "id",
    "name",
    "sku",
    "description",
    "unitOfMeasure",
    "status",
    "createdAt",
    "updatedAt",
] as const;

/**
 * Maps an internal Part read model to the canonical PublicPartDto.
 */
export function toPublicPartDto(
    item: PartDetailViewModel | PartListItem | any,
): PublicPartDto {
    return {
        id: item.id,
        name: item.name,
        sku: item.sku ?? null,
        description: item.description ?? null,
        unitOfMeasure: item.unitOfMeasure,
        status: item.status,
        createdAt: new Date(item.createdAt).toISOString(),
        updatedAt: new Date(item.updatedAt).toISOString(),
    };
}
