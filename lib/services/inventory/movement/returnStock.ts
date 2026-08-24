import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { returnStockSchema } from "./stockMovement.schemas";
import { lockInventoryBalance } from "@/lib/services/inventory/balance/lockInventoryBalance";
import {
    ExcessiveReturnError,
    PartNotFoundError,
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
    WorkOrderNotFoundError,
    WorkOrderPartNotFoundError,
} from "./stockMovementErrors";
import {
    Prisma,
    InventoryLocationStatus,
    StockMovementType,
} from "@/generated/prisma/client";
import type { StockReturnResult } from "./stockMovement.types";

/**
 * Returns previously consumed parts from a WorkOrder back into inventory stock.
 * Increments quantityOnHand while leaving quantityReserved untouched (returned parts are available).
 *
 * Immutability & Ledger-Derived Net Consumption:
 *   - The original WorkOrderPart record is write-once and is NEVER modified.
 *   - Creates an immutable StockMovement ledger entry of type RETURN referencing originalWorkOrderPartId.
 *   - Concurrency & Invariant Safety: The over-return check (verifying return quantity does not exceed
 *     the remaining unreturned net quantity) runs strictly inside the pessimistic transaction lock
 *     via tx.stockMovement.findMany, preventing concurrent double-return race conditions.
 *   - Allows returning parts even if the catalog Part is currently INACTIVE (reversing past operational usage).
 *
 * RBAC & Operational Persona:
 *   Enforces PERMISSIONS.INVENTORY_RETURN, which includes TECHNICIAN, DISPATCHER, MANAGER, ADMIN, and OWNER.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_RETURN.
 *   3. VALIDATION: Parse input payload through returnStockSchema.
 *   4. PRE-TRANSACTION RESOLUTION (Fail-Fast):
 *      - Verify Part exists in workspace (inactive parts permitted).
 *      - Verify InventoryLocation exists and is ACTIVE.
 *      - Verify WorkOrder exists in workspace.
 *      - Verify WorkOrderPart exists and matches the workOrderId and partId.
 *   5. ATOMIC TRANSACTION & OVER-RETURN GUARD (Race-Safe Critical Section):
 *      - Acquire exclusive row lock via lockInventoryBalance.
 *      - Query prior RETURN movements within tx (serialized against the balance lock).
 *      - Enforce invariant: return quantity <= netRemainingQty (throws ExcessiveReturnError if violated).
 *      - Increment quantityOnHand by return quantity (quantityReserved untouched).
 *      - Create immutable StockMovement record of type RETURN with originalWorkOrderPartId linked.
 *   6. READ MODEL PROJECTION: Return structured StockReturnResult with updated netQuantityConsumed.
 */
export async function returnStock(
    workspaceId: string,
    input: unknown,
): Promise<StockReturnResult> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_RETURN permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_RETURN,
    );

    // --- 3. Validate Input Payload ---
    const data = returnStockSchema.parse(input);

    // --- 4. Pre-Transaction Resolution & Status Checks (Fail-Fast) ---
    const [part, location, workOrder, workOrderPart] = await Promise.all([
        prisma.part.findFirst({
            where: {
                id: data.partId,
                workspaceId,
            },
        }),
        prisma.inventoryLocation.findFirst({
            where: {
                id: data.locationId,
                workspaceId,
            },
        }),
        prisma.workOrder.findFirst({
            where: {
                id: data.workOrderId,
                workspaceId,
            },
        }),
        prisma.workOrderPart.findFirst({
            where: {
                id: data.originalWorkOrderPartId,
                workspaceId,
            },
        }),
    ]);

    if (!part) {
        throw new PartNotFoundError();
    }

    if (!location) {
        throw new InventoryLocationNotFoundError();
    }

    if (location.status !== InventoryLocationStatus.ACTIVE) {
        throw new InventoryLocationInactiveError(
            "Cannot return stock to an inactive inventory location.",
        );
    }

    if (!workOrder) {
        throw new WorkOrderNotFoundError(
            "Work order not found in authorized workspace.",
        );
    }

    if (
        !workOrderPart ||
        workOrderPart.workOrderId !== data.workOrderId ||
        workOrderPart.partId !== data.partId
    ) {
        throw new WorkOrderPartNotFoundError(
            "Original work order part consumption record not found or does not match specified work order and part.",
        );
    }

    // --- 5. Atomic Transaction: Lock Balance, Guard Invariant within Lock, & Mutate ---
    const returnQty = new Prisma.Decimal(data.quantity);

    const { updatedBalance, movement, finalNetConsumed } =
        await prisma.$transaction(async (tx) => {
            // a. Lock InventoryBalance row (or lazily create 0-balance row and lock it)
            const lockedBalance = await lockInventoryBalance(
                tx,
                workspaceId,
                data.partId,
                data.locationId,
            );

            // b. Race-Safe Over-Return Guard inside transaction lock
            const priorReturnMovements = await tx.stockMovement.findMany({
                where: {
                    workspaceId,
                    originalWorkOrderPartId: data.originalWorkOrderPartId,
                    movementType: StockMovementType.RETURN,
                },
            });

            const priorReturnedQty = priorReturnMovements.reduce(
                (sum, m) => sum.add(new Prisma.Decimal(m.quantity)),
                new Prisma.Decimal(0),
            );
            const grossQty = new Prisma.Decimal(workOrderPart.quantity);
            const netRemainingQty = grossQty.sub(priorReturnedQty);

            if (returnQty.greaterThan(netRemainingQty)) {
                throw new ExcessiveReturnError(
                    `Cannot return more parts than the remaining net-consumed quantity on this work order part record. Net remaining: ${netRemainingQty.toString()}, Requested return: ${returnQty.toString()}`,
                );
            }

            const currentOnHand = new Prisma.Decimal(
                lockedBalance.quantityOnHand,
            );
            const newOnHand = currentOnHand.add(returnQty);

            // c. Update InventoryBalance with workspace scoping (quantityOnHand only)
            const updated = await tx.inventoryBalance.update({
                where: {
                    id: lockedBalance.id,
                    workspaceId,
                },
                data: {
                    quantityOnHand: newOnHand,
                },
            });

            // d. Financial snapshot credit: matches the original consumption unit cost
            const unitCostSnapshot = new Prisma.Decimal(
                workOrderPart.unitCostAtTimeOfUse,
            );

            // e. Create immutable StockMovement ledger record with movementType = RETURN
            const createdMovement = await tx.stockMovement.create({
                data: {
                    workspaceId,
                    partId: data.partId,
                    locationId: data.locationId,
                    movementType: StockMovementType.RETURN,
                    quantity: returnQty,
                    workOrderId: data.workOrderId,
                    originalWorkOrderPartId: data.originalWorkOrderPartId,
                    unitCostSnapshot,
                    reason: data.reason ?? null,
                    referenceNumber: data.referenceNumber ?? null,
                    actorMemberId: authorization.membership.id,
                },
            });

            return {
                updatedBalance: updated,
                movement: createdMovement,
                finalNetConsumed: Number(netRemainingQty.sub(returnQty)),
            };
        });

    // --- 6. Canonical Read Model Projection ---
    const onHandNumber = Number(updatedBalance.quantityOnHand);
    const reservedNumber = Number(updatedBalance.quantityReserved);

    return {
        balance: {
            id: updatedBalance.id,
            workspaceId: updatedBalance.workspaceId,
            partId: updatedBalance.partId,
            locationId: updatedBalance.locationId,
            quantityOnHand: onHandNumber,
            quantityReserved: reservedNumber,
            quantityAvailable: onHandNumber - reservedNumber,
            createdAt: updatedBalance.createdAt,
            updatedAt: updatedBalance.updatedAt,
        },
        movement: {
            id: movement.id,
            workspaceId: movement.workspaceId,
            partId: movement.partId,
            locationId: movement.locationId,
            movementType: movement.movementType,
            quantity: Number(movement.quantity),
            fromLocationId: movement.fromLocationId,
            toLocationId: movement.toLocationId,
            workOrderId: movement.workOrderId,
            originalWorkOrderPartId: movement.originalWorkOrderPartId,
            unitCostSnapshot:
                movement.unitCostSnapshot !== null
                    ? Number(movement.unitCostSnapshot)
                    : null,
            reason: movement.reason,
            referenceNumber: movement.referenceNumber,
            actorMemberId: movement.actorMemberId,
            createdAt: movement.createdAt,
        },
        workOrderPart: {
            id: workOrderPart.id,
            workspaceId: workOrderPart.workspaceId,
            workOrderId: workOrderPart.workOrderId,
            partId: workOrderPart.partId,
            locationId: workOrderPart.locationId,
            quantity: Number(workOrderPart.quantity),
            unitCostAtTimeOfUse: Number(workOrderPart.unitCostAtTimeOfUse),
            partName: workOrderPart.partName,
            partSku: workOrderPart.partSku,
            unitOfMeasure: workOrderPart.unitOfMeasure,
            consumedByMemberId: workOrderPart.consumedByMemberId,
            consumedAt: workOrderPart.consumedAt,
            notes: workOrderPart.notes,
            createdAt: workOrderPart.createdAt,
            netQuantityConsumed: finalNetConsumed,
        },
    };
}
