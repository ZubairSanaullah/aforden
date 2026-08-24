import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { listTechnicianStockQuerySchema } from "./inventoryBalance.schemas";
import type {
    InventoryBalanceDetailViewModel,
    InventoryBalanceListResult,
} from "./inventoryBalance.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves a paginated list of inventory balances scoped to locations assigned to a specific technician.
 * Uses the technicianProfileId foreign key on InventoryLocation from the locked schema.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_VIEW.
 *   3. VALIDATION: Parse and apply defaults to pagination and sort parameters.
 *   4. PERSISTENCE:
 *      - Query assigned InventoryLocations for the technician in the workspace.
 *      - If none found, return empty paginated result.
 *      - Query InventoryBalance rows for the technician's location IDs.
 *   5. READ MODEL: Project into InventoryBalanceListResult with dynamically derived quantityAvailable.
 */
export async function listTechnicianStock(
    workspaceId: string,
    technicianProfileId: string,
    rawQuery: unknown = {},
): Promise<InventoryBalanceListResult> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_VIEW,
    );

    // --- 3. Validate Query Parameters ---
    const query = listTechnicianStockQuerySchema.parse(rawQuery);

    const { page, pageSize, sortBy, sortOrder } = query;

    // --- 4. Resolve Technician Assigned Locations ---
    const assignedLocations = await prisma.inventoryLocation.findMany({
        where: {
            workspaceId,
            technicianProfileId,
        },
        select: {
            id: true,
        },
    });

    if (assignedLocations.length === 0) {
        return {
            items: [],
            pagination: {
                page,
                pageSize,
                total: 0,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: page > 1,
            },
        };
    }

    const locationIds = assignedLocations.map((loc) => loc.id);

    // --- 5. Query Balances for Assigned Locations ---
    const where: Prisma.InventoryBalanceWhereInput = {
        workspaceId,
        locationId: {
            in: locationIds,
        },
    };

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const [items, total] = await Promise.all([
        prisma.inventoryBalance.findMany({
            where,
            skip,
            take,
            orderBy: [
                { [sortBy]: sortOrder },
                { id: "asc" },
            ],
        }),
        prisma.inventoryBalance.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // --- 6. Canonical Read Model Projection ---
    const projectedItems: InventoryBalanceDetailViewModel[] = items.map(
        (balance) => {
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
        },
    );

    return {
        items: projectedItems,
        pagination: {
            page,
            pageSize,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
        },
    };
}
