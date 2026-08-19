import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { CustomerContact } from "@/generated/prisma/client";

/**
 * Retrieves a single CustomerContact by ID for a specific Customer within an authorized workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_VIEW permission (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN, or ACCOUNTANT).
 *   - Verifies customer ownership within the authorized workspace.
 *   - Contact query is strictly scoped by both `id` AND `customerId`.
 *   - Returns `CustomerContact | null` if not found (never leaks existence across customers or workspaces).
 */
export async function getCustomerContact(
    workspaceId: string,
    customerId: string,
    contactId: string,
): Promise<CustomerContact | null> {
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
        return null;
    }

    // --- Customer-Scoped Contact Lookup ---
    const contact = await prisma.customerContact.findFirst({
        where: {
            id: contactId,
            customerId,
        },
    });

    return contact;
}
