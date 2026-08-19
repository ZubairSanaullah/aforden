import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createCustomerContactSchema } from "@/lib/validations/customerContact";
import {
    CustomerNotFoundError,
    InactiveCustomerError,
    CustomerContactCreationError,
    CustomerContactPrimaryExistsError,
} from "./customerErrors";
import type { CustomerContact } from "@/generated/prisma/client";

/**
 * Creates a CustomerContact for a customer in a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the CUSTOMERS_UPDATE permission (OWNER, ADMIN, MANAGER, DISPATCHER).
 *   - Customer lookup is strictly tenant-scoped (`where: { id: customerId, workspaceId }`).
 *   - Target customer must have status ACTIVE (inactive customers reject contact creation).
 *   - Enforces primary-contact invariant (at most one primary contact per customer).
 *   - Concurrency safe against simultaneous primary contact creations.
 *   - Disallows injection of system-managed fields (id, customerId, workspaceId, timestamps).
 *   - Returns the created CustomerContact record.
 */
export async function createCustomerContact(
    workspaceId: string,
    customerId: string,
    input: unknown,
): Promise<CustomerContact> {
    // --- 1. Validate Input Payload ---
    const validated = createCustomerContactSchema.parse(input);

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
        throw new InactiveCustomerError();
    }

    // --- 6. Primary Contact Pre-Check ---
    if (validated.isPrimary) {
        const existingPrimary = await prisma.customerContact.findFirst({
            where: {
                customerId,
                isPrimary: true,
            },
        });

        if (existingPrimary) {
            throw new CustomerContactPrimaryExistsError();
        }
    }

    // --- 7. Execute Creation with Concurrency Collision Handling ---
    try {
        const contact = await prisma.customerContact.create({
            data: {
                customerId,
                firstName: validated.firstName,
                lastName: validated.lastName,
                title: validated.title ?? null,
                email: validated.email ?? null,
                phone: validated.phone ?? null,
                mobilePhone: validated.mobilePhone ?? null,
                isPrimary: validated.isPrimary ?? false,
                notes: validated.notes ?? null,
            },
        });

        return contact;
    } catch (error: any) {
        // Prisma code P2002: Unique constraint violation (e.g. concurrent primary contact creation)
        if (error?.code === "P2002") {
            throw new CustomerContactPrimaryExistsError();
        }

        throw new CustomerContactCreationError(
            error instanceof Error
                ? error.message
                : "Failed to create customer contact record.",
        );
    }
}
