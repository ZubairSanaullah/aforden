import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { CustomerNotFoundError } from "./customerErrors";
import type { ServiceLocation } from "@/generated/prisma/client";

/**
 * Retrieves a single ServiceLocation by ID for a specific Customer within an authorized workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_VIEW permission (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN, or ACCOUNTANT).
 *   - Verifies customer ownership within the authorized workspace (throws CustomerNotFoundError if not found).
 *   - Location query is strictly scoped by both `id` AND `customerId`.
 *   - Returns `ServiceLocation | null` if not found under that customer.
 *   - Reading locations of INACTIVE customers is permitted.
 */
export async function getServiceLocation(
    workspaceId: string,
    customerId: string,
    locationId: string,
): Promise<ServiceLocation | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce CUSTOMERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_VIEW,
    );

    // --- Verify Customer Belongs to Authorized Workspace ---
    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            workspaceId,
        },
    });

    if (!customer) {
        throw new CustomerNotFoundError();
    }

    // --- Customer-Scoped ServiceLocation Lookup ---
    const location = await prisma.serviceLocation.findFirst({
        where: {
            id: locationId,
            customerId,
        },
    });

    return location;
}
