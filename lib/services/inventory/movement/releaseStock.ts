import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { releaseStockSchema } from "./stockMovement.schemas";
import { lockInventoryBalance } from "@/lib/services/inventory/balance/lockInventoryBalance";
import {
    InsufficientStockError,
    PartNotFoundError,
    PartInactiveError,
    InventoryLocationNotFoundError,
    WorkOrderNotFoundError,
} from "./stockMovementErrors";
import {
    Prisma,
    PartStatus,
    StockMovementType,
} from "@/generated/prisma/client";
import type { StockReleaseResult } from "./stockMovement.types";

/**
 * Releases previously reserved stock of a Part at an InventoryLocation.
 * Decrements quantityReserved while leaving quantityOnHand untouched.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_RESERVE (OWNER, ADMIN, MANAGER, DISPATCHER).
 *   3. VALIDATION: Parse input payload through releaseStockSchema (positive quantity).
 *   4. PRE-TRANSACTION RESOLUTION (Fail-Fast):
 *      - Verify Part exists and is ACTIVE.
 *      - Verify InventoryLocation exists (can release from decommissioned/inactive locations).
 *      - If workOrderId is provided, verify WorkOrder exists in the authorized workspace.
 *   5. ATOMIC TRANSACTION:
 *      - Acquire exclusive row lock via lockInventoryBalance.
 *      - Compute newReserved = currentReserved - quantity.
 *      - Enforce invariant: newReserved >= 0 (throws InsufficientStockError if release exceeds reserved).
 *      - Persist updated InventoryBalance with workspace scoping (quantityReserved only).
 *      - Persist immutable StockMovement record with movementType = RELEASE and positive quantity.
 *   6. READ MODEL PROJECTION: Return structured StockReleaseResult.
 */
export async function releaseStock(
    workspaceId: string,
    input: unknown,
): Promise<StockReleaseResult> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_RESERVE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_RESERVE,
    );

    // --- 3. Validate Input Payload ---
    const data = releaseStockSchema.parse(input);

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
        data.workOrderId
            ? prisma.workOrder.findFirst({
                  where: {
                      id: data.workOrderId,
                      workspaceId,
                  },
              })
            : Promise.resolve(null),
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

    if (data.workOrderId && !workOrder) {
        throw new WorkOrderNotFoundError(
            "Referenced work order not found in authorized workspace.",
        );
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

            // b. Compute new quantityReserved
            const currentReserved = new Prisma.Decimal(
                lockedBalance.quantityReserved,
            );
            const releaseQty = new Prisma.Decimal(data.quantity);
            const newReserved = currentReserved.sub(releaseQty);

            // c. Enforce Invariant: cannot release more than is currently reserved (quantityReserved >= 0)
            if (newReserved.lessThan(0)) {
                throw new InsufficientStockError(
                    `Cannot release more stock than is currently reserved. Current reserved: ${currentReserved.toString()}, Requested release: ${releaseQty.toString()}`,
                );
            }

            // d. Update InventoryBalance with workspace scoping (quantityOnHand is untouched)
            const updated = await tx.inventoryBalance.update({
                where: {
                    id: lockedBalance.id,
                    workspaceId,
                },
                data: {
                    quantityReserved: newReserved,
                },
            });

            const unitCostSnapshot =
                part.unitCost !== null
                    ? new Prisma.Decimal(part.unitCost)
                    : null;

            // e. Create immutable StockMovement ledger record
            const createdMovement = await tx.stockMovement.create({
                data: {
                    workspaceId,
                    partId: data.partId,
                    locationId: data.locationId,
                    movementType: StockMovementType.RELEASE,
                    quantity: releaseQty,
                    workOrderId: data.workOrderId ?? null,
                    unitCostSnapshot,
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
