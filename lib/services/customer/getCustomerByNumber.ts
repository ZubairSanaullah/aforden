import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { Customer } from "@/generated/prisma/client";

/**
 * Retrieves a single Customer by customerNumber within an authorized workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_VIEW permission (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN, or ACCOUNTANT).
 *   - Query is strictly scoped by both `workspaceId` AND `customerNumber`.
 *   - Returns `Customer | null` if not found in the workspace.
 *   - Customer numbers in another workspace are never accessible.
 */
export async function getCustomerByNumber(
    workspaceId: string,
    customerNumber: string,
): Promise<Customer | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce CUSTOMERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_VIEW,
    );

    if (!customerNumber || customerNumber.trim() === "") {
        return null;
    }

    // --- Tenant-Scoped Lookup ---
    const customer = await prisma.customer.findUnique({
        where: {
            workspaceId_customerNumber: {
                workspaceId,
                customerNumber: customerNumber.trim(),
            },
        },
    });

    return customer;
}
