import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    CustomerNotFoundError,
    CustomerContactNotFoundError,
    InactiveCustomerError,
    CustomerContactDeletionError,
    CustomerContactDeletionNotAllowedError,
} from "./customerErrors";
import type { CustomerContact } from "@/generated/prisma/client";

/**
 * Hard deletes a CustomerContact from a Customer in a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_DELETE permission (OWNER or ADMIN).
 *   - Target customer must belong to the authorized workspace and be ACTIVE.
 *   - Contact lookup is strictly scoped to `customerId`.
 *   - Deleting a primary contact does NOT automatically promote another contact;
 *     the customer will simply have zero primary contacts.
 *   - Physically removes the record from the database.
 *   - Returns the deleted CustomerContact record.
 */
export async function deleteCustomerContact(
    workspaceId: string,
    customerId: string,
    contactId: string,
): Promise<CustomerContact> {
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
        throw new InactiveCustomerError("Cannot delete contacts for an inactive customer.");
    }

    // --- 5. Customer-Scoped Contact Lookup ---
    const existingContact = await prisma.customerContact.findFirst({
        where: {
            id: contactId,
            customerId,
        },
    });

    if (!existingContact) {
        throw new CustomerContactNotFoundError();
    }

    // --- 6. Execute Physical Deletion with Safe Error Translation ---
    try {
        const deleted = await prisma.customerContact.delete({
            where: {
                id: contactId,
            },
        });

        return deleted;
    } catch (error: any) {
        if (error?.code === "P2025") {
            throw new CustomerContactNotFoundError();
        }

        if (error?.code === "P2003") {
            throw new CustomerContactDeletionNotAllowedError();
        }

        throw new CustomerContactDeletionError(
            error instanceof Error
                ? error.message
                : "Failed to delete customer contact record.",
        );
    }
}
