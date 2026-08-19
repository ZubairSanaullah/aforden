import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
    InactiveCustomerError,
    ServiceLocationDeletionError,
    ServiceLocationDeletionNotAllowedError,
} from "./customerErrors";
import type { ServiceLocation } from "@/generated/prisma/client";

/**
 * Hard deletes a ServiceLocation from a Customer in a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_DELETE permission (OWNER or ADMIN).
 *   - Target customer must belong to the authorized workspace and be ACTIVE.
 *   - Location lookup is strictly scoped to `customerId`.
 *   - Deleting a primary location does NOT automatically promote another location;
 *     the customer will simply have zero primary locations.
 *   - Physically removes the record from the database.
 *   - Returns the deleted ServiceLocation record.
 */
export async function deleteServiceLocation(
    workspaceId: string,
    customerId: string,
    locationId: string,
): Promise<ServiceLocation> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce CUSTOMERS_DELETE permission (OWNER, ADMIN) ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_DELETE,
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
            "Cannot delete service locations for an inactive customer.",
        );
    }

    // --- 5. Customer-Scoped ServiceLocation Lookup ---
    const existingLocation = await prisma.serviceLocation.findFirst({
        where: {
            id: locationId,
            customerId,
        },
    });

    if (!existingLocation) {
        throw new ServiceLocationNotFoundError();
    }

    // --- 6. Execute Physical Deletion with Safe Error Translation ---
    try {
        const deleted = await prisma.serviceLocation.delete({
            where: {
                id: locationId,
            },
        });

        return deleted;
    } catch (error: any) {
        if (error?.code === "P2025") {
            throw new ServiceLocationNotFoundError();
        }

        if (error?.code === "P2003") {
            throw new ServiceLocationDeletionNotAllowedError();
        }

        throw new ServiceLocationDeletionError(
            error instanceof Error
                ? error.message
                : "Failed to delete service location record.",
        );
    }
}
