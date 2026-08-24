import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { getInventoryBalanceParamsSchema } from "./inventoryBalance.schemas";
import { PartNotFoundError } from "@/lib/services/inventory/part/partErrors";
import { InventoryLocationNotFoundError } from "@/lib/services/inventory/inventoryLocation/inventoryLocationErrors";
import type { InventoryBalanceDetailViewModel } from "./inventoryBalance.types";

/**
 * Retrieves the current InventoryBalance for a specific (partId, locationId) pair in a workspace.
 *
 * Behavior:
 *   1. Authenticates caller and verifies workspace membership.
 *   2. Asserts PERMISSIONS.INVENTORY_VIEW.
 *   3. Queries existing InventoryBalance record for { workspaceId, partId, locationId }.
 *   4. If a record exists, computes quantityAvailable (quantityOnHand - quantityReserved) and returns it.
 *   5. If NO record exists:
 *      - Confirms the Part and InventoryLocation both belong to this workspace (throws PartNotFoundError or InventoryLocationNotFoundError if invalid).
 *      - Returns a synthetic zero-balance view model with id: null, createdAt: null, updatedAt: null, and 0 for all stock quantities.
 */
export async function getInventoryBalance(
    workspaceId: string,
    partId: string,
    locationId: string,
): Promise<InventoryBalanceDetailViewModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_VIEW,
    );

    // --- 3. Validate Lookup Identifiers ---
    const params = getInventoryBalanceParamsSchema.parse({
        partId,
        locationId,
    });

    // --- 4. Query Existing InventoryBalance Record ---
    const balance = await prisma.inventoryBalance.findFirst({
        where: {
            workspaceId,
            partId: params.partId,
            locationId: params.locationId,
        },
    });

    if (balance) {
        const onHand = Number(balance.quantityOnHand);
        const reserved = Number(balance.quantityReserved);

        return {
            id: balance.id,
            workspaceId: balance.workspaceId,
            partId: balance.partId,
            locationId: balance.locationId,
            quantityOnHand: onHand,
            quantityReserved: reserved,
            quantityAvailable: onHand - reserved,
            createdAt: balance.createdAt,
            updatedAt: balance.updatedAt,
        };
    }

    // --- 5. Lazy / Zero Balance Handling: Verify Entities Belong to Workspace ---
    const [partExists, locationExists] = await Promise.all([
        prisma.part.findFirst({
            where: {
                id: params.partId,
                workspaceId,
            },
            select: { id: true },
        }),
        prisma.inventoryLocation.findFirst({
            where: {
                id: params.locationId,
                workspaceId,
            },
            select: { id: true },
        }),
    ]);

    if (!partExists) {
        throw new PartNotFoundError();
    }

    if (!locationExists) {
        throw new InventoryLocationNotFoundError();
    }

    // Return synthetic zero-balance view model for valid un-stocked part-location pair
    return {
        id: null,
        workspaceId,
        partId: params.partId,
        locationId: params.locationId,
        quantityOnHand: 0,
        quantityReserved: 0,
        quantityAvailable: 0,
        createdAt: null,
        updatedAt: null,
    };
}
