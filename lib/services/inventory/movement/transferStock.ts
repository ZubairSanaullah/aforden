import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { transferStockSchema } from "./stockMovement.schemas";
import { lockInventoryBalance } from "@/lib/services/inventory/balance/lockInventoryBalance";
import {
    TransferSameLocationError,
    InsufficientStockError,
    PartNotFoundError,
    PartInactiveError,
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
} from "./stockMovementErrors";
import {
    Prisma,
    PartStatus,
    InventoryLocationStatus,
    StockMovementType,
} from "@/generated/prisma/client";
import type { StockTransferResult } from "./stockMovement.types";

/**
 * Transfers stock of a specific Part between two InventoryLocations in a workspace.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_TRANSFER (OWNER, ADMIN, MANAGER, DISPATCHER).
 *   3. VALIDATION: Parse input payload through transferStockSchema.
 *   4. BUSINESS RULE: Verify fromLocationId !== toLocationId (throws TransferSameLocationError 422).
 *   5. PRE-TRANSACTION RESOLUTION (Fail-Fast):
 *      - Verify Part exists and is ACTIVE.
 *      - Verify fromLocation exists (inactive source is permitted for decommissioning).
 *      - Verify toLocation exists and is ACTIVE (inactive destination is rejected).
 *   6. ATOMIC TRANSACTION WITH DETERMINISTIC LOCK ORDERING:
 *      - Lexicographically sort location IDs [fromLocationId, toLocationId] to avoid circular deadlocks.
 *      - Acquire exclusive row locks in sorted order via lockInventoryBalance.
 *      - Verify source has sufficient quantityAvailable (onHand - reserved >= quantity).
 *      - Decrement source quantityOnHand and increment destination quantityOnHand.
 *      - Create paired StockMovement ledger records (TRANSFER_OUT and TRANSFER_IN).
 *   7. READ MODEL PROJECTION: Return structured StockTransferResult.
 */
export async function transferStock(
    workspaceId: string,
    input: unknown,
): Promise<StockTransferResult> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_TRANSFER permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_TRANSFER,
    );

    // --- 3. Validate Input Payload ---
    const data = transferStockSchema.parse(input);

    // --- 4. Cross-Field Guard: Source and Destination must differ ---
    if (data.fromLocationId === data.toLocationId) {
        throw new TransferSameLocationError();
    }

    // --- 5. Pre-Transaction Resolution & Status Checks (Fail-Fast) ---
    const [part, fromLocation, toLocation] = await Promise.all([
        prisma.part.findFirst({
            where: {
                id: data.partId,
                workspaceId,
            },
        }),
        prisma.inventoryLocation.findFirst({
            where: {
                id: data.fromLocationId,
                workspaceId,
            },
        }),
        prisma.inventoryLocation.findFirst({
            where: {
                id: data.toLocationId,
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

    if (!fromLocation) {
        throw new InventoryLocationNotFoundError(
            "Source inventory location not found in authorized workspace.",
        );
    }

    if (!toLocation) {
        throw new InventoryLocationNotFoundError(
            "Destination inventory location not found in authorized workspace.",
        );
    }

    // Destination location must be ACTIVE to receive inbound transfers (Section 4.2)
    if (toLocation.status !== InventoryLocationStatus.ACTIVE) {
        throw new InventoryLocationInactiveError(
            "Destination inventory location is inactive and cannot receive transferred stock.",
        );
    }

    // --- 6. Deterministic Lock Ordering to Prevent Deadlocks ---
    // Sort location IDs lexicographically so concurrent opposite-direction transfers
    // (A -> B and B -> A) always lock rows in the exact same sequence.
    const sortedLocationIds = [data.fromLocationId, data.toLocationId].sort((a, b) =>
        a.localeCompare(b),
    );
    const firstLocId = sortedLocationIds[0];
    const secondLocId = sortedLocationIds[1];

    // --- 7. Atomic Transaction ---
    const {
        updatedSourceBalance,
        updatedDestBalance,
        transferOutMovement,
        transferInMovement,
    } = await prisma.$transaction(async (tx) => {
        // a. Acquire row locks in deterministic sequence
        const lock1 = await lockInventoryBalance(
            tx,
            workspaceId,
            data.partId,
            firstLocId,
        );
        const lock2 = await lockInventoryBalance(
            tx,
            workspaceId,
            data.partId,
            secondLocId,
        );

        // b. Identify source and destination locked records
        const sourceLocked =
            firstLocId === data.fromLocationId ? lock1 : lock2;
        const destLocked =
            firstLocId === data.toLocationId ? lock1 : lock2;

        // c. Verify source has sufficient available stock (onHand - reserved >= quantity)
        const sourceOnHand = new Prisma.Decimal(sourceLocked.quantityOnHand);
        const sourceReserved = new Prisma.Decimal(sourceLocked.quantityReserved);
        const sourceAvailable = sourceOnHand.sub(sourceReserved);
        const transferQty = new Prisma.Decimal(data.quantity);

        if (sourceAvailable.lessThan(transferQty)) {
            throw new InsufficientStockError(
                `Insufficient available stock at source location. Available: ${sourceAvailable.toString()}, Requested: ${transferQty.toString()}`,
            );
        }

        // d. Compute updated onHand quantities (reserved is untouched on both)
        const newSourceOnHand = sourceOnHand.sub(transferQty);
        const destOnHand = new Prisma.Decimal(destLocked.quantityOnHand);
        const newDestOnHand = destOnHand.add(transferQty);

        // e. Persist updated balances with workspace scoping
        const [updatedSource, updatedDest] = await Promise.all([
            tx.inventoryBalance.update({
                where: {
                    id: sourceLocked.id,
                    workspaceId,
                },
                data: {
                    quantityOnHand: newSourceOnHand,
                },
            }),
            tx.inventoryBalance.update({
                where: {
                    id: destLocked.id,
                    workspaceId,
                },
                data: {
                    quantityOnHand: newDestOnHand,
                },
            }),
        ]);

        const unitCostSnapshot =
            part.unitCost !== null ? new Prisma.Decimal(part.unitCost) : null;

        // f. Create paired StockMovement ledger records
        const [outMovement, inMovement] = await Promise.all([
            tx.stockMovement.create({
                data: {
                    workspaceId,
                    partId: data.partId,
                    locationId: data.fromLocationId,
                    movementType: StockMovementType.TRANSFER_OUT,
                    quantity: transferQty,
                    fromLocationId: data.fromLocationId,
                    toLocationId: data.toLocationId,
                    unitCostSnapshot,
                    reason: data.reason ?? null,
                    referenceNumber: data.referenceNumber ?? null,
                    actorMemberId: authorization.membership.id,
                },
            }),
            tx.stockMovement.create({
                data: {
                    workspaceId,
                    partId: data.partId,
                    locationId: data.toLocationId,
                    movementType: StockMovementType.TRANSFER_IN,
                    quantity: transferQty,
                    fromLocationId: data.fromLocationId,
                    toLocationId: data.toLocationId,
                    unitCostSnapshot,
                    reason: data.reason ?? null,
                    referenceNumber: data.referenceNumber ?? null,
                    actorMemberId: authorization.membership.id,
                },
            }),
        ]);

        return {
            updatedSourceBalance: updatedSource,
            updatedDestBalance: updatedDest,
            transferOutMovement: outMovement,
            transferInMovement: inMovement,
        };
    });

    // --- 8. Canonical Read Model Projection ---
    const sourceOnHandNum = Number(updatedSourceBalance.quantityOnHand);
    const sourceReservedNum = Number(updatedSourceBalance.quantityReserved);

    const destOnHandNum = Number(updatedDestBalance.quantityOnHand);
    const destReservedNum = Number(updatedDestBalance.quantityReserved);

    return {
        sourceBalance: {
            id: updatedSourceBalance.id,
            workspaceId: updatedSourceBalance.workspaceId,
            partId: updatedSourceBalance.partId,
            locationId: updatedSourceBalance.locationId,
            quantityOnHand: sourceOnHandNum,
            quantityReserved: sourceReservedNum,
            quantityAvailable: sourceOnHandNum - sourceReservedNum,
            createdAt: updatedSourceBalance.createdAt,
            updatedAt: updatedSourceBalance.updatedAt,
        },
        destinationBalance: {
            id: updatedDestBalance.id,
            workspaceId: updatedDestBalance.workspaceId,
            partId: updatedDestBalance.partId,
            locationId: updatedDestBalance.locationId,
            quantityOnHand: destOnHandNum,
            quantityReserved: destReservedNum,
            quantityAvailable: destOnHandNum - destReservedNum,
            createdAt: updatedDestBalance.createdAt,
            updatedAt: updatedDestBalance.updatedAt,
        },
        transferOutMovement: {
            id: transferOutMovement.id,
            workspaceId: transferOutMovement.workspaceId,
            partId: transferOutMovement.partId,
            locationId: transferOutMovement.locationId,
            movementType: transferOutMovement.movementType,
            quantity: Number(transferOutMovement.quantity),
            fromLocationId: transferOutMovement.fromLocationId,
            toLocationId: transferOutMovement.toLocationId,
            workOrderId: transferOutMovement.workOrderId,
            originalWorkOrderPartId: transferOutMovement.originalWorkOrderPartId,
            unitCostSnapshot:
                transferOutMovement.unitCostSnapshot !== null
                    ? Number(transferOutMovement.unitCostSnapshot)
                    : null,
            reason: transferOutMovement.reason,
            referenceNumber: transferOutMovement.referenceNumber,
            actorMemberId: transferOutMovement.actorMemberId,
            createdAt: transferOutMovement.createdAt,
        },
        transferInMovement: {
            id: transferInMovement.id,
            workspaceId: transferInMovement.workspaceId,
            partId: transferInMovement.partId,
            locationId: transferInMovement.locationId,
            movementType: transferInMovement.movementType,
            quantity: Number(transferInMovement.quantity),
            fromLocationId: transferInMovement.fromLocationId,
            toLocationId: transferInMovement.toLocationId,
            workOrderId: transferInMovement.workOrderId,
            originalWorkOrderPartId: transferInMovement.originalWorkOrderPartId,
            unitCostSnapshot:
                transferInMovement.unitCostSnapshot !== null
                    ? Number(transferInMovement.unitCostSnapshot)
                    : null,
            reason: transferInMovement.reason,
            referenceNumber: transferInMovement.referenceNumber,
            actorMemberId: transferInMovement.actorMemberId,
            createdAt: transferInMovement.createdAt,
        },
    };
}
