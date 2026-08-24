import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { consumeStockSchema } from "./stockMovement.schemas";
import { lockInventoryBalance } from "@/lib/services/inventory/balance/lockInventoryBalance";
import {
    InsufficientStockError,
    PartNotFoundError,
    PartInactiveError,
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
    WorkOrderNotFoundError,
} from "./stockMovementErrors";
import {
    Prisma,
    PartStatus,
    InventoryLocationStatus,
    StockMovementType,
} from "@/generated/prisma/client";
import type { StockConsumptionResult } from "./stockMovement.types";

/**
 * Consumes stock of a Part at an InventoryLocation for execution of a WorkOrder.
 * Fulfills an active reservation by decrementing both quantityOnHand and quantityReserved.
 * Creates an immutable WorkOrderPart consumption record and a StockMovement ledger entry.
 *
 * RBAC & Operational Persona:
 *   Enforces PERMISSIONS.INVENTORY_CONSUME, which includes TECHNICIAN, DISPATCHER, MANAGER, ADMIN, and OWNER.
 *   This allows field technicians to record parts used on job sites.
 *
 * Cost Snapshot Handling:
 *   - StockMovement.unitCostSnapshot: Nullable Decimal column. Preserves `null` when part.unitCost is null,
 *     consistent with all sibling movement services (receiveStock, adjustStock, reserveStock, releaseStock).
 *   - WorkOrderPart.unitCostAtTimeOfUse: Non-nullable Decimal column in schema (used for downstream billing).
 *     Defaults to Decimal("0.00") when part.unitCost is null.
 *
 * Invariant & Reservation Fulfillment Model:
 *   - Strict reservation fulfillment: decrements both quantityOnHand and quantityReserved by the consumed quantity.
 *   - Floor guards: throws InsufficientStockError if newOnHand < 0 (physical stock shortage)
 *     or if newReserved < 0 (consumption exceeds current reservation).
 *   - Live operational pull: requires location to be ACTIVE (throws InventoryLocationInactiveError).
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_CONSUME.
 *   3. VALIDATION: Parse input payload through consumeStockSchema (workOrderId required).
 *   4. PRE-TRANSACTION RESOLUTION (Fail-Fast):
 *      - Verify Part exists and is ACTIVE.
 *      - Verify InventoryLocation exists and is ACTIVE.
 *      - Verify WorkOrder exists in the authorized workspace.
 *   5. ATOMIC TRANSACTION:
 *      - Acquire exclusive row lock via lockInventoryBalance.
 *      - Verify sufficient quantityOnHand (>= quantity) and sufficient quantityReserved (>= quantity).
 *      - Decrement both quantityOnHand and quantityReserved.
 *      - Create immutable WorkOrderPart snapshot record (write-once, no updatedAt).
 *      - Create immutable StockMovement record with movementType = CONSUMPTION.
 *   6. READ MODEL PROJECTION: Return structured StockConsumptionResult.
 */
export async function consumeStock(
    workspaceId: string,
    input: unknown,
): Promise<StockConsumptionResult> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_CONSUME permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_CONSUME,
    );

    // --- 3. Validate Input Payload ---
    const data = consumeStockSchema.parse(input);

    // --- 4. Pre-Transaction Resolution & Status Checks (Fail-Fast) ---
    const [part, location, workOrder] = await Promise.all([
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
    ]);

    if (!part) {
        throw new PartNotFoundError();
    }

    if (part.status !== PartStatus.ACTIVE) {
        throw new PartInactiveError();
    }

    if (!location) {
        throw new InventoryLocationNotFoundError();
    }

    if (location.status !== InventoryLocationStatus.ACTIVE) {
        throw new InventoryLocationInactiveError(
            "Cannot consume stock from an inactive inventory location.",
        );
    }

    if (!workOrder) {
        throw new WorkOrderNotFoundError(
            "Work order not found in authorized workspace.",
        );
    }

    // --- 5. Atomic Transaction: Lock Balance, Mutate, & Record WorkOrderPart + Ledger ---
    const { updatedBalance, movement, createdWorkOrderPart } =
        await prisma.$transaction(async (tx) => {
            // a. Lock InventoryBalance row (or lazily create 0-balance row and lock it)
            const lockedBalance = await lockInventoryBalance(
                tx,
                workspaceId,
                data.partId,
                data.locationId,
            );

            const currentOnHand = new Prisma.Decimal(
                lockedBalance.quantityOnHand,
            );
            const currentReserved = new Prisma.Decimal(
                lockedBalance.quantityReserved,
            );
            const consumeQty = new Prisma.Decimal(data.quantity);

            // b. Check on-hand stock availability
            const newOnHand = currentOnHand.sub(consumeQty);
            if (newOnHand.lessThan(0)) {
                throw new InsufficientStockError(
                    `Cannot consume stock exceeding physical quantity on hand. On hand: ${currentOnHand.toString()}, Requested consumption: ${consumeQty.toString()}`,
                );
            }

            // c. Check reservation fulfillment (strict reservation model)
            const newReserved = currentReserved.sub(consumeQty);
            if (newReserved.lessThan(0)) {
                throw new InsufficientStockError(
                    `Cannot consume stock exceeding reserved quantity. Current reserved: ${currentReserved.toString()}, Requested consumption: ${consumeQty.toString()}`,
                );
            }

            // d. Update InventoryBalance with workspace scoping
            const updated = await tx.inventoryBalance.update({
                where: {
                    id: lockedBalance.id,
                    workspaceId,
                },
                data: {
                    quantityOnHand: newOnHand,
                    quantityReserved: newReserved,
                },
            });

            // Financial snapshot resolution:
            // WorkOrderPart.unitCostAtTimeOfUse is non-nullable Decimal in schema -> defaults to 0.00 if part.unitCost is null
            const woPartCostSnapshot =
                part.unitCost !== null
                    ? new Prisma.Decimal(part.unitCost)
                    : new Prisma.Decimal("0.00");

            // StockMovement.unitCostSnapshot is nullable Decimal? in schema -> preserves null if part.unitCost is null
            const movementCostSnapshot =
                part.unitCost !== null ? new Prisma.Decimal(part.unitCost) : null;

            // e. Create immutable WorkOrderPart snapshot record (Section 7.1)
            const createdWOPart = await tx.workOrderPart.create({
                data: {
                    workspaceId,
                    workOrderId: data.workOrderId,
                    partId: data.partId,
                    locationId: data.locationId,
                    quantity: consumeQty,
                    unitCostAtTimeOfUse: woPartCostSnapshot,
                    partName: part.name,
                    partSku: part.sku ?? null,
                    unitOfMeasure: part.unitOfMeasure,
                    consumedByMemberId: authorization.membership.id,
                    notes: data.notes ?? data.reason ?? null,
                },
            });

            // f. Create immutable StockMovement ledger record
            const createdMovement = await tx.stockMovement.create({
                data: {
                    workspaceId,
                    partId: data.partId,
                    locationId: data.locationId,
                    movementType: StockMovementType.CONSUMPTION,
                    quantity: consumeQty,
                    workOrderId: data.workOrderId,
                    originalWorkOrderPartId:
                        data.originalWorkOrderPartId ?? createdWOPart.id,
                    unitCostSnapshot: movementCostSnapshot,
                    reason: data.reason ?? data.notes ?? null,
                    referenceNumber: data.referenceNumber ?? null,
                    actorMemberId: authorization.membership.id,
                },
            });

            return {
                updatedBalance: updated,
                movement: createdMovement,
                createdWorkOrderPart: createdWOPart,
            };
        });

    // --- 6. Canonical Read Model Projection ---
    const onHandNumber = Number(updatedBalance.quantityOnHand);
    const reservedNumber = Number(updatedBalance.quantityReserved);
    const woPartQty = Number(createdWorkOrderPart.quantity);

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
            id: createdWorkOrderPart.id,
            workspaceId: createdWorkOrderPart.workspaceId,
            workOrderId: createdWorkOrderPart.workOrderId,
            partId: createdWorkOrderPart.partId,
            locationId: createdWorkOrderPart.locationId,
            quantity: woPartQty,
            unitCostAtTimeOfUse: Number(createdWorkOrderPart.unitCostAtTimeOfUse),
            partName: createdWorkOrderPart.partName,
            partSku: createdWorkOrderPart.partSku,
            unitOfMeasure: createdWorkOrderPart.unitOfMeasure,
            consumedByMemberId: createdWorkOrderPart.consumedByMemberId,
            consumedAt: createdWorkOrderPart.consumedAt,
            notes: createdWorkOrderPart.notes,
            createdAt: createdWorkOrderPart.createdAt,
            netQuantityConsumed: woPartQty, // No returns on initial creation
        },
    };
}
