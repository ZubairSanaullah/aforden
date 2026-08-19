import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    CustomerNotFoundError,
    CustomerContactNotFoundError,
    InactiveCustomerError,
    CustomerContactPrimaryExistsError,
    CustomerContactUpdateError,
} from "./customerErrors";
import type { CustomerContact } from "@/generated/prisma/client";

/**
 * Sets a specified CustomerContact as the authoritative primary contact for a Customer.
 *
 * Business & Architectural guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_UPDATE permission (OWNER, ADMIN, MANAGER, DISPATCHER).
 *   - Customer must exist within the authorized workspace and have status ACTIVE.
 *   - Target contact must belong strictly to the specified customer.
 *   - If the contact is already primary, the operation is completely idempotent and returns
 *     the existing contact record without performing redundant database writes.
 *   - If another contact is currently primary, executes an atomic transaction that:
 *       1. Demotes the current primary contact (`isPrimary = false`).
 *       2. Promotes the requested contact (`isPrimary = true`).
 *   - Guarantees transactional all-or-nothing atomicity (no intermediate partial state).
 *   - Concurrency safe against simultaneous promotion races (translates P2002 to CustomerContactPrimaryExistsError).
 *   - Data fields (`firstName`, `lastName`, `email`, `phone`, `notes`) and system identifiers are preserved untouched.
 *   - Returns the promoted CustomerContact record.
 */
export async function setPrimaryCustomerContact(
    workspaceId: string,
    customerId: string,
    contactId: string,
): Promise<CustomerContact> {
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
        throw new InactiveCustomerError("Cannot set primary contact for an inactive customer.");
    }

    // --- 5. Customer-Scoped Contact Lookup ---
    const targetContact = await prisma.customerContact.findFirst({
        where: {
            id: contactId,
            customerId,
        },
    });

    if (!targetContact) {
        throw new CustomerContactNotFoundError();
    }

    // --- 6. Idempotency Check: Already Primary ---
    if (targetContact.isPrimary) {
        return targetContact;
    }

    // --- 7. Transactional Primary Reassignment ---
    try {
        const result = await prisma.$transaction(async (tx) => {
            // Find any other contact for this customer that is currently primary
            const currentPrimary = await tx.customerContact.findFirst({
                where: {
                    customerId,
                    isPrimary: true,
                    NOT: {
                        id: contactId,
                    },
                },
            });

            // If another primary exists, demote it first within the transaction
            if (currentPrimary) {
                await tx.customerContact.update({
                    where: { id: currentPrimary.id },
                    data: { isPrimary: false },
                });
            }

            // Promote the target contact
            const promoted = await tx.customerContact.update({
                where: { id: contactId },
                data: { isPrimary: true },
            });

            return promoted;
        });

        return result;
    } catch (error: any) {
        // Prisma code P2002: Unique constraint violation on concurrent race
        if (error?.code === "P2002") {
            throw new CustomerContactPrimaryExistsError();
        }

        throw new CustomerContactUpdateError(
            error instanceof Error
                ? error.message
                : "Failed to set primary customer contact.",
        );
    }
}
