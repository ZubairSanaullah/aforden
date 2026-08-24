import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { WorkOrderPartNotFoundError } from "./workOrderPartErrors";
import { StockMovementType } from "@/generated/prisma/client";
import type { WorkOrderPartDetailViewModel } from "./workOrderPart.types";

/**
 * Retrieves a single WorkOrderPart record by ID within the authorized workspace.
 * Computes ledger-derived netQuantityConsumed (gross quantity minus return movements).
 */
export async function getWorkOrderPart(
    workspaceId: string,
    workOrderPartId: string,
): Promise<WorkOrderPartDetailViewModel> {
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    assertPermission(authorization.membership.role, PERMISSIONS.INVENTORY_VIEW);

    const record = await prisma.workOrderPart.findFirst({
        where: {
            id: workOrderPartId,
            workspaceId,
        },
        include: {
            stockMovements: {
                where: {
                    workspaceId,
                    movementType: StockMovementType.RETURN,
                },
            },
        },
    });

    if (!record) {
        throw new WorkOrderPartNotFoundError();
    }

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
}
