import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    CustomerNotFoundError,
    CustomerDeletionError,
    CustomerDeletionNotAllowedError,
} from "./customerErrors";
import type { Customer } from "@/generated/prisma/client";

export interface CustomerDeletionEligibility {
    allowed: boolean;
    reason?: string;
}

/**
 * Evaluates whether a Customer is eligible for hard deletion.
 *
 * Deletion Invariants:
 *   - ACTIVE customers cannot be hard-deleted directly; they must first be deactivated (status = INACTIVE).
 *   - Hard deletion is strictly an exceptional administrative cleanup action.
 *   - Future operational models (work orders, invoices, locations) will attach dependency checks here.
 */
export function canDeleteCustomer(customer: Customer): CustomerDeletionEligibility {
    if (customer.status === "ACTIVE") {
        return {
            allowed: false,
            reason: "Active customers cannot be deleted. The customer must first be deactivated.",
        };
    }

    return { allowed: true };
}

/**
 * Asserts that a Customer satisfies all domain deletion eligibility criteria.
 * Throws CustomerDeletionNotAllowedError if deletion is disallowed.
 */
export function assertCustomerCanBeDeleted(customer: Customer): void {
    const eligibility = canDeleteCustomer(customer);
    if (!eligibility.allowed) {
        throw new CustomerDeletionNotAllowedError(eligibility.reason);
    }
}

/**
 * Hard deletes a Customer from a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the CUSTOMERS_DELETE permission (OWNER or ADMIN).
 *   - Customer lookup is strictly tenant-scoped (`where: { id: customerId, workspaceId }`).
 *   - Customer must be INACTIVE; active customers are rejected with CustomerDeletionNotAllowedError.
 *   - Never leaks existence of customers in other workspaces.
 *   - Physically removes the record without cascading into historical operational records.
 *   - Returns the deleted Customer record.
 */
export async function deleteCustomer(
    workspaceId: string,
    customerId: string,
): Promise<Customer> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce CUSTOMERS_DELETE permission (OWNER or ADMIN) ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_DELETE,
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

    // --- Domain Policy: Deletion Eligibility Assertion ---
    assertCustomerCanBeDeleted(existing);

    // --- Execute Hard Deletion with Safe Error Translation ---
    try {
        const deleted = await prisma.customer.delete({
            where: {
                id: customerId,
            },
        });

        return deleted;
    } catch (error: any) {
        // Prisma code P2025: Record to delete does not exist
        if (error?.code === "P2025") {
            throw new CustomerNotFoundError();
        }

        // Prisma code P2003: Foreign key constraint violation (protected references)
        if (error?.code === "P2003") {
            throw new CustomerDeletionNotAllowedError(
                "Cannot delete customer because protected operational references exist.",
            );
        }

        throw new CustomerDeletionError(
            error instanceof Error
                ? error.message
                : "Failed to delete customer record.",
        );
    }
}
