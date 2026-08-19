import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
    InactiveCustomerError,
    ServiceLocationPrimaryExistsError,
    ServiceLocationUpdateError,
} from "./customerErrors";
import type { ServiceLocation } from "@/generated/prisma/client";

/**
 * Sets a specified ServiceLocation as the authoritative primary location for a Customer.
 *
 * Business & Architectural guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_UPDATE permission (OWNER, ADMIN, MANAGER, DISPATCHER).
 *   - Customer must exist within the authorized workspace and have status ACTIVE.
 *   - Target location must belong strictly to the specified customer.
 *   - If the location is already primary, the operation is completely idempotent and returns
 *     the existing location record without performing redundant database writes.
 *   - If another location is currently primary, executes an atomic transaction that:
 *       1. Demotes the current primary location (`isPrimary = false`).
 *       2. Promotes the requested location (`isPrimary = true`).
 *   - Guarantees transactional all-or-nothing atomicity (no intermediate partial state).
 *   - Concurrency safe against simultaneous promotion races (translates P2002 to ServiceLocationPrimaryExistsError).
 *   - Data fields (`name`, `addressLine1`, coordinates, notes) and system identifiers are preserved untouched.
 *   - Returns the promoted ServiceLocation record.
 */
export async function setPrimaryServiceLocation(
    workspaceId: string,
    customerId: string,
    locationId: string,
): Promise<ServiceLocation> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce CUSTOMERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_UPDATE,
    );

    // --- 3. Tenant-Scoped Customer Lookup ---
    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            workspaceId,
        },
    });

    if (!customer) {
        throw new CustomerNotFoundError();
    }

    // --- 4. Customer Lifecycle Check (Must be ACTIVE) ---
    if (customer.status !== "ACTIVE") {
        throw new InactiveCustomerError(
            "Cannot set primary service location for an inactive customer.",
        );
    }

    // --- 5. Customer-Scoped Location Lookup ---
    const targetLocation = await prisma.serviceLocation.findFirst({
        where: {
            id: locationId,
            customerId,
        },
    });

    if (!targetLocation) {
        throw new ServiceLocationNotFoundError();
    }

    // --- 6. Idempotency Check: Already Primary ---
    if (targetLocation.isPrimary) {
        return targetLocation;
    }

    // --- 7. Transactional Primary Reassignment ---
    try {
        const result = await prisma.$transaction(async (tx) => {
            // Find any other location for this customer that is currently primary
            const currentPrimary = await tx.serviceLocation.findFirst({
                where: {
                    customerId,
                    isPrimary: true,
                    NOT: {
                        id: locationId,
                    },
                },
            });

            // If another primary exists, demote it first within the transaction
            if (currentPrimary) {
                await tx.serviceLocation.update({
                    where: { id: currentPrimary.id },
                    data: { isPrimary: false },
                });
            }

            // Promote the target location
            const promoted = await tx.serviceLocation.update({
                where: { id: locationId },
                data: { isPrimary: true },
            });

            return promoted;
        });

        return result;
    } catch (error: any) {
        // Prisma code P2002: Unique constraint violation on concurrent race
        if (error?.code === "P2002") {
            throw new ServiceLocationPrimaryExistsError();
        }

        throw new ServiceLocationUpdateError(
            error instanceof Error
                ? error.message
                : "Failed to set primary service location.",
        );
    }
}
