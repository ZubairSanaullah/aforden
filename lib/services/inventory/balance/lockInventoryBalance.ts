import { Prisma, type InventoryBalance } from "@/generated/prisma/client";

/**
 * Internal transaction-scoped helper that acquires an exclusive row-level lock (SELECT FOR UPDATE)
 * on the InventoryBalance record for a specific (workspaceId, partId, locationId) tuple.
 *
 * Requirements (Phase 1.10.1 Section 8.2 & Phase 1.10.7 Requirement 4):
 *   1. Must only be executed within an existing Prisma interactive transaction client (`tx`).
 *   2. Scoped by workspaceId, partId, and locationId.
 *   3. If no row exists yet for this tuple, lazily creates it within the same transaction (with quantityOnHand=0,
 *      quantityReserved=0) and acquires the lock via re-selection.
 *   4. Returns the locked InventoryBalance record with Decimal fields intact for caller-level calculations.
 *
 * NOTE: This is an internal building block for mutating inventory services (receive, transfer, adjust, reserve,
 * consume, return) and is NOT exposed as an API endpoint.
 */
export async function lockInventoryBalance(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    partId: string,
    locationId: string,
): Promise<InventoryBalance> {
    // 1. Attempt to acquire an exclusive row lock
    const lockedRows = await tx.$queryRaw<InventoryBalance[]>`
        SELECT * FROM "InventoryBalance"
        WHERE "workspaceId" = ${workspaceId}
          AND "partId" = ${partId}
          AND "locationId" = ${locationId}
        FOR UPDATE
    `;

    if (lockedRows && lockedRows.length > 0) {
        return lockedRows[0];
    }

    // 2. If no balance row exists yet, attempt to create it within the transaction.
    // In PostgreSQL, a failed INSERT inside a transaction block aborts the entire transaction
    // unless protected by a SAVEPOINT. We establish a savepoint so that a P2002 collision
    // can be rolled back to the savepoint without aborting the enclosing transaction.
    if (typeof tx.$executeRaw === "function") {
        await tx.$executeRaw`SAVEPOINT lazy_create_balance`;
    }

    try {
        await tx.inventoryBalance.create({
            data: {
                workspaceId,
                partId,
                locationId,
                quantityOnHand: new Prisma.Decimal(0),
                quantityReserved: new Prisma.Decimal(0),
            },
        });
        if (typeof tx.$executeRaw === "function") {
            await tx.$executeRaw`RELEASE SAVEPOINT lazy_create_balance`;
        }
    } catch (error: any) {
        if (typeof tx.$executeRaw === "function") {
            try {
                await tx.$executeRaw`ROLLBACK TO SAVEPOINT lazy_create_balance`;
            } catch {
                // Ignore savepoint rollback error if transaction already in terminal state
            }
        }

        const isUniqueCollision =
            error?.code === "P2002" ||
            (typeof error?.message === "string" &&
                error.message.includes("Unique constraint failed"));

        if (!isUniqueCollision) {
            throw error;
        }
        // Lost the creation race to another concurrent transaction —
        // savepoint rolled back cleanly, transaction remains active,
        // fall through to re-lock, which will pick up and lock the winner's row.
    }

    // 3. Re-acquire the exclusive row lock on the newly created record
    const reLockedRows = await tx.$queryRaw<InventoryBalance[]>`
        SELECT * FROM "InventoryBalance"
        WHERE "workspaceId" = ${workspaceId}
          AND "partId" = ${partId}
          AND "locationId" = ${locationId}
        FOR UPDATE
    `;

    if (!reLockedRows || reLockedRows.length === 0) {
        throw new Error(
            "lockInventoryBalance: expected row to exist after create or concurrent creation, found none.",
        );
    }

    return reLockedRows[0];
}
