import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateCustomerContactSchema } from "@/lib/validations/customerContact";
import {
    CustomerNotFoundError,
    CustomerContactNotFoundError,
    InactiveCustomerError,
    CustomerContactPrimaryExistsError,
    CustomerContactUpdateError,
} from "./customerErrors";
import type { CustomerContact, Prisma } from "@/generated/prisma/client";

/**
 * Updates an existing CustomerContact for a customer in a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_UPDATE permission (OWNER, ADMIN, MANAGER, DISPATCHER).
 *   - Target customer must belong to the authorized workspace and have status ACTIVE.
 *   - Contact lookup is strictly scoped to `customerId`.
 *   - Supports partial updates and explicit clearing of nullable fields (`null`).
 *   - Enforces the primary-contact single-holder rule without silent demotions.
 *   - Concurrency safe against simultaneous primary promotions (intercepts P2002).
 *   - Disallows modification of system-managed fields (`id`, `customerId`, `workspaceId`, `createdAt`).
 *   - Returns the updated CustomerContact record.
 */
export async function updateCustomerContact(
    workspaceId: string,
    customerId: string,
    contactId: string,
    input: unknown,
): Promise<CustomerContact> {
    // --- 1. Validate Input Payload ---
    const validated = updateCustomerContactSchema.parse(input);

    // --- 2. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 3. RBAC: Enforce CUSTOMERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_UPDATE,
    );

    // --- 4. Tenant-Scoped Customer Lookup ---
    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            workspaceId,
        },
    });

    if (!customer) {
        throw new CustomerNotFoundError();
    }

    // --- 5. Customer Lifecycle Check (Must be ACTIVE) ---
    if (customer.status !== "ACTIVE") {
        throw new InactiveCustomerError("Cannot update contacts for an inactive customer.");
    }

    // --- 6. Customer-Scoped Contact Lookup ---
    const existingContact = await prisma.customerContact.findFirst({
        where: {
            id: contactId,
            customerId,
        },
    });

    if (!existingContact) {
        throw new CustomerContactNotFoundError();
    }

    // --- 7. Primary Contact Promotion Pre-Check ---
    if (validated.isPrimary === true && !existingContact.isPrimary) {
        const existingPrimary = await prisma.customerContact.findFirst({
            where: {
                customerId,
                isPrimary: true,
                NOT: {
                    id: contactId,
                },
            },
        });

        if (existingPrimary) {
            throw new CustomerContactPrimaryExistsError();
        }
    }

    // --- 8. Build Explicit Update Payload ---
    const data: Prisma.CustomerContactUpdateInput = {};

    if (validated.firstName !== undefined) data.firstName = validated.firstName;
    if (validated.lastName !== undefined) data.lastName = validated.lastName;
    if (validated.title !== undefined) data.title = validated.title;
    if (validated.email !== undefined) data.email = validated.email;
    if (validated.phone !== undefined) data.phone = validated.phone;
    if (validated.mobilePhone !== undefined) data.mobilePhone = validated.mobilePhone;
    if (validated.isPrimary !== undefined) data.isPrimary = validated.isPrimary;
    if (validated.notes !== undefined) data.notes = validated.notes;

    // --- 9. Execute Update with Concurrency Collision Protection ---
    try {
        const updated = await prisma.customerContact.update({
            where: {
                id: contactId,
            },
            data,
        });

        return updated;
    } catch (error: any) {
        // Prisma code P2002: Unique constraint violation on concurrent primary promotion
        if (error?.code === "P2002") {
            throw new CustomerContactPrimaryExistsError();
        }

        throw new CustomerContactUpdateError(
            error instanceof Error
                ? error.message
                : "Failed to update customer contact record.",
        );
    }
}
