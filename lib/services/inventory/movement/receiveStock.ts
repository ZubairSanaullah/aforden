import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { receiveStockSchema } from "./stockMovement.schemas";
import { lockInventoryBalance } from "@/lib/services/inventory/balance/lockInventoryBalance";
import {
    PartNotFoundError,
    PartInactiveError,
} from "@/lib/services/inventory/part/partErrors";
import {
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
} from "@/lib/services/inventory/inventoryLocation/inventoryLocationErrors";
import {
    Prisma,
    PartStatus,
    InventoryLocationStatus,
    StockMovementType,
} from "@/generated/prisma/client";
import type { StockReceiptResult } from "./stockMovement.types";

/**
 * Receives stock into an InventoryLocation, incrementing quantityOnHand and appending a RECEIPT StockMovement ledger entry.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_RECEIVE (OWNER, ADMIN, MANAGER).
 *   3. VALIDATION: Parse input payload through receiveStockSchema (validates positive quantity).
 *   4. PRE-TRANSACTION RESOLUTION:
 *      - Verify Part exists in workspace and is ACTIVE (fail fast).
 *      - Verify InventoryLocation exists in workspace and is ACTIVE (fail fast).
 *      - Resolve effective unitCostSnapshot (caller override > Part.unitCost catalog snapshot > null).
 *   5. ATOMIC TRANSACTION:
 *      - Acquire exclusive row lock via lockInventoryBalance (or lazily create initial balance row).
 *      - Increment quantityOnHand by received quantity (quantityReserved remains untouched).
 *      - Persist updated InventoryBalance with workspace scoping.
 *      - Persist immutable StockMovement ledger entry with movementType = RECEIPT and actorMemberId.
 *   6. READ MODEL PROJECTION: Return structured StockReceiptResult containing both updated balance and movement.
 */
export async function receiveStock(
    workspaceId: string,
    input: unknown,
): Promise<StockReceiptResult> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_RECEIVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_RECEIVE,
    );

    // --- 3. Validate Input Payload ---
    const data = receiveStockSchema.parse(input);

    // --- 4. Pre-Transaction Resolution & Entity Status Checks (Fail-Fast) ---
    const [part, location] = await Promise.all([
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
        throw new InventoryLocationInactiveError();
    }

    // Resolve snapshot unit cost: caller-supplied takes precedence, falls back to catalog Part.unitCost
    const effectiveUnitCostSnapshot =
        data.unitCostSnapshot !== undefined
            ? data.unitCostSnapshot
            : part.unitCost !== null
              ? Number(part.unitCost)
              : null;

    // --- 5. Atomic Transaction: Lock Balance, Mutate, & Record Ledger ---
    const { updatedBalance, movement } = await prisma.$transaction(
        async (tx) => {
            // a. Lock InventoryBalance row (or lazily create 0-balance row and lock it)
            const lockedBalance = await lockInventoryBalance(
                tx,
                workspaceId,
                data.partId,
                data.locationId,
            );

            // b. Compute new quantityOnHand
            const currentOnHand = new Prisma.Decimal(lockedBalance.quantityOnHand);
            const addQuantity = new Prisma.Decimal(data.quantity);
            const newOnHand = currentOnHand.add(addQuantity);

            // c. Update InventoryBalance with workspace scoping
            const updated = await tx.inventoryBalance.update({
                where: {
                    id: lockedBalance.id,
                    workspaceId,
                },
                data: {
                    quantityOnHand: newOnHand,
                },
            });

            // d. Create immutable StockMovement ledger record
            const createdMovement = await tx.stockMovement.create({
                data: {
                    workspaceId,
                    partId: data.partId,
                    locationId: data.locationId,
                    movementType: StockMovementType.RECEIPT,
                    quantity: addQuantity,
                    unitCostSnapshot:
                        effectiveUnitCostSnapshot !== null
                            ? new Prisma.Decimal(effectiveUnitCostSnapshot)
                            : null,
                    reason: data.reason ?? null,
                    referenceNumber: data.referenceNumber ?? null,
                    actorMemberId: authorization.membership.id,
                },
            });

            return {
                updatedBalance: updated,
                movement: createdMovement,
            };
        },
    );

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
    };
}
