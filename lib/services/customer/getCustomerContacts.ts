import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    customerContactQuerySchema,
    type CustomerContactQueryInput,
} from "@/lib/validations/customerContact";
import { CustomerNotFoundError } from "./customerErrors";
import type { CustomerContactListResult } from "./customer.types";
import type { Prisma } from "@/generated/prisma/client";

const sortFieldMap: Record<string, keyof Prisma.CustomerContactOrderByWithRelationInput> = {
    firstName: "firstName",
    lastName: "lastName",
    email: "email",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    isPrimary: "isPrimary",
};

/**
 * Retrieves a filtered, searched, sorted, and paginated list of CustomerContacts for a Customer.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_VIEW permission (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN, or ACCOUNTANT).
 *   - Verifies customer belongs to the authorized workspace (throws CustomerNotFoundError if not found).
 *   - Queries and counts are strictly scoped to `customerId`.
 *   - Search supports case-insensitive matching across `firstName`, `lastName`, `email`, `phone`, `mobilePhone`, and `title`.
 *   - Sorting uses a strict whitelist with deterministic `{ id: "asc" }` secondary sort.
 *   - Returns items with complete PaginationMetadata.
 */
export async function getCustomerContacts(
    workspaceId: string,
    customerId: string,
    options?: CustomerContactQueryInput,
): Promise<CustomerContactListResult> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce CUSTOMERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_VIEW,
    );

    // --- Tenant Scoping: Verify Customer Exists in Authorized Workspace ---
    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            workspaceId,
        },
    });

    if (!customer) {
        throw new CustomerNotFoundError();
    }

    // --- Validate & Parse Query Options ---
    const query = customerContactQuerySchema.parse(options ?? {});

    // --- Build Customer-Scoped Filter ---
    const where: Prisma.CustomerContactWhereInput = {
        customerId,
        ...(query.isPrimary !== undefined ? { isPrimary: query.isPrimary } : {}),
    };

    if (query.search && query.search.length > 0) {
        where.OR = [
            { firstName: { contains: query.search, mode: "insensitive" } },
            { lastName: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
            { phone: { contains: query.search, mode: "insensitive" } },
            { mobilePhone: { contains: query.search, mode: "insensitive" } },
            { title: { contains: query.search, mode: "insensitive" } },
        ];
    }

    const sortField = sortFieldMap[query.sortBy] ?? "createdAt";
    const orderBy: Prisma.CustomerContactOrderByWithRelationInput[] = [
        { [sortField]: query.sortOrder },
        { id: "asc" },
    ];

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- Execute Parallel Count & FindMany ---
    const [total, records] = await Promise.all([
        prisma.customerContact.count({ where }),
        prisma.customerContact.findMany({
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
