import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { listStockMovementsQuerySchema } from "./stockMovement.schemas";
import type { Prisma } from "@/generated/prisma/client";
import type {
    StockMovementDetailViewModel,
    StockMovementListResult,
} from "./stockMovement.types";

/**
 * Retrieves a paginated list of StockMovement ledger entries within an authorized workspace.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_VIEW.
 *   3. VALIDATION: Parse and sanitize filter parameters.
 *   4. PERSISTENCE: Query StockMovement records with tenant isolation and compound deterministic sort.
 *   5. READ MODEL: Project into StockMovementListResult with pagination metadata.
 */
export async function listStockMovements(
    workspaceId: string,
    rawQuery: unknown = {},
): Promise<StockMovementListResult> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_VIEW,
    );

    // --- 3. Validate Query Parameters ---
    const query = listStockMovementsQuerySchema.parse(rawQuery);

    const {
        partId,
        locationId,
        movementType,
        workOrderId,
        originalWorkOrderPartId,
        actorMemberId,
        startDate,
        endDate,
        page,
        pageSize,
        sortBy,
        sortOrder,
    } = query;

    // --- 4. Build Scoped Prisma Where Clause ---
    const where: Prisma.StockMovementWhereInput = {
        workspaceId,
    };

    if (partId) {
        where.partId = partId;
    }

    if (locationId) {
        where.OR = [
            { locationId },
            { fromLocationId: locationId },
            { toLocationId: locationId },
        ];
    }

    if (movementType) {
        where.movementType = movementType;
    }

    if (workOrderId) {
        where.workOrderId = workOrderId;
    }

    if (originalWorkOrderPartId) {
        where.originalWorkOrderPartId = originalWorkOrderPartId;
    }

    if (actorMemberId) {
        where.actorMemberId = actorMemberId;
    }

    if (startDate || endDate) {
        where.createdAt = {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
        };
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const [items, total] = await Promise.all([
        prisma.stockMovement.findMany({
            where,
            skip,
            take,
            orderBy: [
                { [sortBy]: sortOrder },
                { id: "asc" },
            ],
        }),
        prisma.stockMovement.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // --- 5. Canonical Read Model Projection ---
    const projectedItems: StockMovementDetailViewModel[] = items.map((m) => ({
        id: m.id,
        workspaceId: m.workspaceId,
        partId: m.partId,
        locationId: m.locationId,
        movementType: m.movementType,
        quantity: Number(m.quantity),
        fromLocationId: m.fromLocationId,
        toLocationId: m.toLocationId,
        workOrderId: m.workOrderId,
        originalWorkOrderPartId: m.originalWorkOrderPartId,
        unitCostSnapshot:
            m.unitCostSnapshot !== null ? Number(m.unitCostSnapshot) : null,
        reason: m.reason,
        referenceNumber: m.referenceNumber,
        actorMemberId: m.actorMemberId,
        createdAt: m.createdAt,
    }));

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
