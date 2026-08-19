import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { CustomerOperationalReadModel } from "./customer.types";

/**
 * Retrieves an aggregated operational read model of a Customer,
 * including primary contact, primary service location, and relationship counts.
 *
 * Security:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_VIEW permission.
 *   - Customer lookup is strictly scoped to `workspaceId`.
 *
 * @returns The populated `CustomerOperationalReadModel`, or `null` if not found.
 */
export async function getCustomerOperationalSummary(
    workspaceId: string,
    customerId: string,
): Promise<CustomerOperationalReadModel | null> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce CUSTOMERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_VIEW,
    );

    // --- 3. Scoped Operational Query with Eager Projections ---
    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            workspaceId,
        },
        include: {
            contacts: {
                where: { isPrimary: true },
                take: 1,
            },
            locations: {
                where: { isPrimary: true },
                take: 1,
            },
            _count: {
                select: {
                    contacts: true,
                    locations: true,
                },
            },
        },
    });

    if (!customer) {
        return null;
    }

    return {
        id: customer.id,
        workspaceId: customer.workspaceId,
        customerNumber: customer.customerNumber,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        website: customer.website,
        addressLine1: customer.addressLine1,
        addressLine2: customer.addressLine2,
        city: customer.city,
        state: customer.state,
        postalCode: customer.postalCode,
        country: customer.country,
        status: customer.status,
        notes: customer.notes,
        primaryContact: customer.contacts[0] ?? null,
        primaryLocation: customer.locations[0] ?? null,
        contactsCount: customer._count.contacts,
        locationsCount: customer._count.locations,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
    };
}
