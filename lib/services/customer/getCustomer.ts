import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Customer } from "@/generated/prisma/client";

/**
 * Retrieves a single Customer by ID within an authorized workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_VIEW permission (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN, or ACCOUNTANT).
 *   - Query is strictly scoped by both `id` AND `workspaceId`.
 *   - Returns `Customer | null` if not found in the workspace (never leaks existence across workspaces).
 */
export async function getCustomer(
    workspaceId: string,
    customerId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<Customer | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // --- RBAC: Enforce CUSTOMERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            workspaceId,
        },
    });

    return customer;
}
