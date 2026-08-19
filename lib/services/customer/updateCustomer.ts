import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateCustomerSchema } from "@/lib/validations/customer";
import {
    CustomerNotFoundError,
    DuplicateCustomerNumberError,
    CustomerUpdateError,
    InvalidCustomerError,
} from "./customerErrors";
import type { Customer, Prisma } from "@/generated/prisma/client";

/**
 * Updates a Customer's profile within an authorized workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the CUSTOMERS_UPDATE permission (OWNER, ADMIN, MANAGER, or DISPATCHER).
 *   - Inputs are validated via Zod (`updateCustomerSchema`).
 *   - Customer lookup is strictly tenant-scoped (`where: { id: customerId, workspaceId }`).
 *   - Partial update semantics: omitted fields (undefined) are preserved; explicit nulls clear nullable fields.
 *   - Customer number invariant: customer numbers cannot be cleared to null once assigned.
 *   - Enforces workspace-scoped uniqueness for customer numbers if modified.
 *   - Concurrency safety: catches Prisma P2002 unique constraint violations and translates them into DuplicateCustomerNumberError.
 *   - Generic profile update cannot modify `status` (lifecycle changes belong to dedicated service).
 *   - Workspace ownership and customer ID cannot be altered.
 */
export async function updateCustomer(
    workspaceId: string,
    customerId: string,
    input: unknown,
): Promise<Customer> {
    // --- Validate Input ---
    const data = updateCustomerSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce CUSTOMERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_UPDATE,
    );

    // --- Tenant-Scoped Customer Lookup ---
    const existing = await prisma.customer.findFirst({
        where: {
            id: customerId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new CustomerNotFoundError();
    }

    // --- Customer Number Invariant: Cannot be cleared to null ---
    if (data.customerNumber === null) {
        throw new InvalidCustomerError(
            "Customer number cannot be cleared once assigned.",
        );
    }

    // --- Check Customer Number Uniqueness if Modified ---
    if (
        data.customerNumber !== undefined &&
        data.customerNumber !== existing.customerNumber
    ) {
        const duplicate = await prisma.customer.findUnique({
            where: {
                workspaceId_customerNumber: {
                    workspaceId,
                    customerNumber: data.customerNumber,
                },
            },
        });

        if (duplicate && duplicate.id !== customerId) {
            throw new DuplicateCustomerNumberError();
        }
    }

    // --- Construct Whitelisted Update Payload (Explicit Field Mapping) ---
    const updateData: Prisma.CustomerUpdateInput = {};

    if (data.name !== undefined) {
        updateData.name = data.name;
    }
    if (data.customerNumber !== undefined && data.customerNumber !== null) {
        updateData.customerNumber = data.customerNumber;
    }
    if (data.email !== undefined) {
        updateData.email = data.email;
    }
    if (data.phone !== undefined) {
        updateData.phone = data.phone;
    }
    if (data.website !== undefined) {
        updateData.website = data.website;
    }
    if (data.addressLine1 !== undefined) {
        updateData.addressLine1 = data.addressLine1;
    }
    if (data.addressLine2 !== undefined) {
        updateData.addressLine2 = data.addressLine2;
    }
    if (data.city !== undefined) {
        updateData.city = data.city;
    }
    if (data.state !== undefined) {
        updateData.state = data.state;
    }
    if (data.postalCode !== undefined) {
        updateData.postalCode = data.postalCode;
    }
    if (data.country !== undefined) {
        updateData.country = data.country;
    }
    if (data.notes !== undefined) {
        updateData.notes = data.notes;
    }

    // --- Execute Update with Concurrency Error Translation ---
    try {
        const updated = await prisma.customer.update({
            where: {
                id: customerId,
            },
            data: updateData,
        });

        return updated;
    } catch (error: any) {
        const isUniqueConstraintViolation =
            error?.code === "P2002" ||
            (typeof error?.message === "string" &&
                error.message.includes("Unique constraint failed"));

        if (isUniqueConstraintViolation) {
            throw new DuplicateCustomerNumberError();
        }

        throw new CustomerUpdateError(
            error instanceof Error
                ? error.message
                : "Failed to update customer record.",
        );
    }
}
