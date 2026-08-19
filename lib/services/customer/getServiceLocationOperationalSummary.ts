import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { ServiceLocationOperationalReadModel } from "./customer.types";

/**
 * Retrieves an operational read model of a ServiceLocation including customer metadata.
 *
 * Security:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_VIEW permission.
 *   - Multi-tenant query ensures Customer belongs to workspace and Location belongs to Customer.
 *
 * @returns The populated `ServiceLocationOperationalReadModel`, or `null` if not found.
 */
export async function getServiceLocationOperationalSummary(
    workspaceId: string,
    customerId: string,
    locationId: string,
): Promise<ServiceLocationOperationalReadModel | null> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce CUSTOMERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_VIEW,
    );

    // --- 3. Scoped Location Query with Customer Projection ---
    const location = await prisma.serviceLocation.findFirst({
        where: {
            id: locationId,
            customerId,
            customer: {
                workspaceId,
            },
        },
        include: {
            customer: {
                select: {
                    id: true,
                    customerNumber: true,
                    name: true,
                    status: true,
                },
            },
        },
    });

    if (!location) {
        return null;
    }

    return {
        id: location.id,
        customerId: location.customerId,
        name: location.name,
        addressLine1: location.addressLine1,
        addressLine2: location.addressLine2,
        city: location.city,
        state: location.state,
        postalCode: location.postalCode,
        country: location.country,
        latitude: location.latitude,
        longitude: location.longitude,
        notes: location.notes,
        isPrimary: location.isPrimary,
        customer: location.customer,
        createdAt: location.createdAt,
        updatedAt: location.updatedAt,
    };
}
