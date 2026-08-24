import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { StockMovementType, type Prisma } from "@/generated/prisma/client";
import type {
    GetWorkOrderPartsFilter,
    PaginatedWorkOrderPartsResult,
} from "./workOrderPart.types";

/**
 * Retrieves a paginated list of WorkOrderPart records for a workspace with optional filters.
 * Computes ledger-derived netQuantityConsumed for each item.
 */
export async function getWorkOrderParts(
    workspaceId: string,
    filters: GetWorkOrderPartsFilter = {},
): Promise<PaginatedWorkOrderPartsResult> {
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    assertPermission(authorization.membership.role, PERMISSIONS.INVENTORY_VIEW);

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.WorkOrderPartWhereInput = {
        workspaceId,
        ...(filters.workOrderId && { workOrderId: filters.workOrderId }),
        ...(filters.partId && { partId: filters.partId }),
        ...(filters.locationId && { locationId: filters.locationId }),
    };

    const [total, records] = await Promise.all([
        prisma.workOrderPart.count({ where }),
        prisma.workOrderPart.findMany({
            where,
            include: {
                stockMovements: {
                    where: {
                        workspaceId,
                        movementType: StockMovementType.RETURN,
                    },
                },
            },
            orderBy: { consumedAt: "desc" },
            skip,
            take: limit,
        }),
    ]);

    const items = records.map((record) => {
        const grossQty = Number(record.quantity);
        const returnedQty = record.stockMovements.reduce(
            (sum, m) => sum + Number(m.quantity),
            0,
        );
        return {
            id: record.id,
            workspaceId: record.workspaceId,
            workOrderId: record.workOrderId,
            partId: record.partId,
            locationId: record.locationId,
            quantity: grossQty,
            unitCostAtTimeOfUse: Number(record.unitCostAtTimeOfUse),
            partName: record.partName,
            partSku: record.partSku,
            unitOfMeasure: record.unitOfMeasure,
            consumedByMemberId: record.consumedByMemberId,
            consumedAt: record.consumedAt,
            notes: record.notes,
            createdAt: record.createdAt,
            netQuantityConsumed: Math.max(0, grossQty - returnedQty),
        };
    });

    return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    };
}
