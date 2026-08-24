import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { adjustStockSchema } from "./stockMovement.schemas";
import { lockInventoryBalance } from "@/lib/services/inventory/balance/lockInventoryBalance";
import {
    InsufficientStockError,
    PartNotFoundError,
    PartInactiveError,
    InventoryLocationNotFoundError,
} from "./stockMovementErrors";
import {
    Prisma,
    PartStatus,
    StockMovementType,
} from "@/generated/prisma/client";
import type { StockAdjustmentResult } from "./stockMovement.types";

/**
 * Manually adjusts stock quantities of a Part at an InventoryLocation.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_ADJUST (OWNER, ADMIN, MANAGER).
 *   3. VALIDATION: Parse input payload through adjustStockSchema (enforces nonzero signed quantity and mandatory reason).
 *   4. PRE-TRANSACTION RESOLUTION (Fail-Fast):
 *      - Verify Part exists and is ACTIVE.
 *      - Verify InventoryLocation exists in workspace (inactive location is allowed for decommissioning adjustments).
 *   5. ATOMIC TRANSACTION:
 *      - Acquire exclusive row lock via lockInventoryBalance (or lazily create initial balance row).
 *      - Compute newOnHand = currentOnHand + quantity (quantity is signed).
 *      - Guard against negative stock: throws InsufficientStockError if newOnHand < 0 (quantityReserved is untouched).
 *      - Persist updated InventoryBalance with workspace scoping.
 *      - Persist immutable StockMovement record with movementType = ADJUSTMENT, storing the signed quantity.
 *   6. READ MODEL PROJECTION: Return structured StockAdjustmentResult.
 */
export async function adjustStock(
    workspaceId: string,
    input: unknown,
): Promise<StockAdjustmentResult> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_ADJUST permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_ADJUST,
    );

    // --- 3. Validate Input Payload ---
    const data = adjustStockSchema.parse(input);

    // --- 4. Pre-Transaction Resolution & Status Checks (Fail-Fast) ---
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

            // b. Compute new quantityOnHand (quantity is signed: + for gain, - for loss)
            const currentOnHand = new Prisma.Decimal(lockedBalance.quantityOnHand);
            const adjustQuantity = new Prisma.Decimal(data.quantity);
            const newOnHand = currentOnHand.add(adjustQuantity);

            // c. Enforce Non-Negative On-Hand Invariant (Section 5.5)
            if (newOnHand.lessThan(0)) {
                throw new InsufficientStockError(
                    `Stock adjustment would result in negative quantity on hand. Current on hand: ${currentOnHand.toString()}, Adjustment: ${adjustQuantity.toString()}`,
                );
            }

            // d. Update InventoryBalance with workspace scoping (reserved is untouched)
            const updated = await tx.inventoryBalance.update({
                where: {
                    id: lockedBalance.id,
                    workspaceId,
                },
                data: {
                    quantityOnHand: newOnHand,
                },
            });

            const unitCostSnapshot =
                part.unitCost !== null ? new Prisma.Decimal(part.unitCost) : null;

            // e. Create immutable StockMovement ledger record storing the signed adjustment quantity
            const createdMovement = await tx.stockMovement.create({
                data: {
                    workspaceId,
                    partId: data.partId,
                    locationId: data.locationId,
                    movementType: StockMovementType.ADJUSTMENT,
                    quantity: adjustQuantity, // Stored as signed Decimal to capture gain (+) or loss (-)
                    unitCostSnapshot,
                    reason: data.reason,
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
