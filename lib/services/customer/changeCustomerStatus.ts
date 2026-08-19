import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateCustomerStatusSchema } from "@/lib/validations/customer";
import {
    CustomerNotFoundError,
    CustomerUpdateError,
} from "./customerErrors";
import type { Customer, CustomerStatus } from "@/generated/prisma/client";

export interface ChangeCustomerStatusOptions {
    status: CustomerStatus;
    reason?: string;
}

/**
 * Changes a Customer's lifecycle status within an authorized workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_UPDATE permission (OWNER, ADMIN, MANAGER, or DISPATCHER).
 *   - Inputs are validated via Zod (`updateCustomerStatusSchema`).
 *   - Customer lookup is strictly tenant-scoped (`where: { id: customerId, workspaceId }`).
 *   - Idempotency: If the requested status matches the current status (e.g. ACTIVE -> ACTIVE),
 *     the existing customer is returned immediately without unnecessary database mutation or timestamp churn.
 *   - Preserves business identity: `customerNumber` is immutable throughout all lifecycle transitions.
 *   - Preserves all customer profile fields (`name`, `email`, `phone`, `website`, address, `notes`).
 *   - Reason handling: `reason` is accepted at the service boundary for future audit capability,
 *     without altering the database schema in this phase.
 *   - Zero deletion side effects: inactive customers remain fully persisted for historical integrity.
 */
export async function changeCustomerStatus(
    workspaceId: string,
    customerId: string,
    statusOrInput: unknown,
    reason?: string,
): Promise<Customer> {
    // --- Normalize Input ---
    let rawInput = statusOrInput;
    if (typeof statusOrInput === "string") {
        rawInput = { status: statusOrInput, reason };
    }

    // --- Validate Input ---
    const data = updateCustomerStatusSchema.parse(rawInput);

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

    // --- Idempotent No-Op: Return existing record if status is unchanged ---
    if (existing.status === data.status) {
        return existing;
    }

    // --- Execute Status Update ---
    try {
        const updated = await prisma.customer.update({
            where: {
                id: customerId,
            },
            data: {
                status: data.status,
            },
        });

        return updated;
    } catch (error: any) {
        throw new CustomerUpdateError(
            error instanceof Error
                ? error.message
                : "Failed to update customer lifecycle status.",
        );
    }
}

/**
 * Standard Aforden naming alias for changeCustomerStatus.
 */
export async function updateCustomerStatus(
    workspaceId: string,
    customerId: string,
    input: unknown,
): Promise<Customer> {
    return changeCustomerStatus(workspaceId, customerId, input);
}

/**
 * Deactivates a Customer (sets status to INACTIVE).
 */
export async function deactivateCustomer(
    workspaceId: string,
    customerId: string,
    reason?: string,
): Promise<Customer> {
    return changeCustomerStatus(workspaceId, customerId, "INACTIVE", reason);
}

/**
 * Reactivates a Customer (sets status to ACTIVE).
 */
export async function reactivateCustomer(
    workspaceId: string,
    customerId: string,
    reason?: string,
): Promise<Customer> {
    return changeCustomerStatus(workspaceId, customerId, "ACTIVE", reason);
}
