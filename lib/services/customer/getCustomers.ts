import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    customerQuerySchema,
    type CustomerQueryInput,
} from "@/lib/validations/customer";
import type { CustomerListResult } from "./customer.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

const sortFieldMap: Record<string, keyof Prisma.CustomerOrderByWithRelationInput> = {
    name: "name",
    customerNumber: "customerNumber",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    city: "city",
    status: "status",
};

/**
 * Retrieves a filtered, searched, sorted, and paginated list of Customers within an authorized workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_VIEW permission (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN, or ACCOUNTANT).
 *   - All queries and counts are strictly scoped by `workspaceId`.
 *   - Search supports case-insensitive matching across `name`, `customerNumber`, `email`, and `phone`.
 *   - Sorting uses a strict whitelist of known fields with deterministic `{ id: "asc" }` tie-breaking.
 *   - Returns items along with complete PaginationMetadata.
 */
export async function getCustomers(
    workspaceId: string,
    options?: CustomerQueryInput,
    actor?: WorkspaceAuthorizationContext,
): Promise<CustomerListResult> {
    // --- Authentication & Workspace Authorization ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // --- RBAC: Enforce CUSTOMERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_VIEW,
    );

    // --- Validate & Parse Query Options ---
    const query = customerQuerySchema.parse(options ?? {});

    // --- Build Tenant-Scoped Filter ---
    const where: Prisma.CustomerWhereInput = {
        workspaceId,
        ...(query.status ? { status: query.status } : {}),
    };

    if (query.search && query.search.length > 0) {
        where.OR = [
            { name: { contains: query.search, mode: "insensitive" } },
            { customerNumber: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
            { phone: { contains: query.search, mode: "insensitive" } },
        ];
    }

    const sortField = sortFieldMap[query.sortBy] ?? "name";
    const orderBy: Prisma.CustomerOrderByWithRelationInput[] = [
        { [sortField]: query.sortOrder },
        { id: "asc" },
    ];

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- Execute Parallel Count & FindMany ---
    const [total, records] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({
            where,
            skip,
            take,
            orderBy,
        }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

    return {
        items: records,
        pagination: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            totalPages,
            hasNextPage: query.page < totalPages,
            hasPreviousPage: query.page > 1 && totalPages > 0,
        },
    };
}
