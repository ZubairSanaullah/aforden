import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { listReservationsQuerySchema } from "./inventoryBalance.schemas";
import type {
    InventoryBalanceDetailViewModel,
    InventoryBalanceListResult,
} from "./inventoryBalance.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves a paginated list of active stock reservations (balances where quantityReserved > 0) in a workspace.
 *
 * Design Justification:
 *   InventoryBalance is the authoritative, materialized representation of active reserved quantities.
 *   Querying balances with quantityReserved > 0 delivers instant, indexed O(1) reads of committed reservations
 *   across parts and locations without requiring expensive full-ledger re-aggregations.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_VIEW.
 *   3. VALIDATION: Parse and apply defaults to partId, locationId, sorting, and pagination parameters.
 *   4. PERSISTENCE: Query InventoryBalance rows with quantityReserved > 0 and compound deterministic sort.
 *   5. READ MODEL: Project into InventoryBalanceListResult with dynamically derived quantityAvailable.
 */
export async function listReservations(
    workspaceId: string,
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
    const query = listReservationsQuerySchema.parse(rawQuery);

    const {
        partId,
        locationId,
        page,
        pageSize,
        sortBy,
        sortOrder,
    } = query;

    // --- 4. Build Scoped Prisma Where Clause ---
    const where: Prisma.InventoryBalanceWhereInput = {
        workspaceId,
        quantityReserved: {
            gt: 0,
        },
    };

    if (partId) {
        where.partId = partId;
    }

    if (locationId) {
        where.locationId = locationId;
    }

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

    // --- 5. Canonical Read Model Projection ---
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
