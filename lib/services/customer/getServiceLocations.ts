import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    serviceLocationQuerySchema,
    type ServiceLocationQueryInput,
} from "@/lib/validations/serviceLocation";
import { CustomerNotFoundError } from "./customerErrors";
import type { ServiceLocationListResult } from "./customer.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

const sortFieldMap: Record<string, keyof Prisma.ServiceLocationOrderByWithRelationInput> = {
    name: "name",
    city: "city",
    state: "state",
    postalCode: "postalCode",
    country: "country",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    isPrimary: "isPrimary",
};

/**
 * Retrieves a filtered, searched, sorted, and paginated list of ServiceLocations for a Customer.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_VIEW permission (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN, or ACCOUNTANT).
 *   - Verifies customer belongs to the authorized workspace (throws CustomerNotFoundError if not found).
 *   - Queries and counts are strictly scoped to `customerId`.
 *   - Search supports case-insensitive matching across `name`, `addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, and `country`.
 *   - Sorting uses a strict whitelist with deterministic `{ id: "asc" }` secondary sort.
 *   - Reading locations of INACTIVE customers is permitted.
 *   - Returns items with complete PaginationMetadata.
 */
export async function getServiceLocations(
    workspaceId: string,
    customerId: string,
    options?: ServiceLocationQueryInput,
    actor?: WorkspaceAuthorizationContext,
): Promise<ServiceLocationListResult> {
    // --- Authentication & Workspace Authorization ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));

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
    const query = serviceLocationQuerySchema.parse(options ?? {});

    // --- Build Customer-Scoped Filter ---
    const where: Prisma.ServiceLocationWhereInput = {
        customerId,
        ...(query.isPrimary !== undefined ? { isPrimary: query.isPrimary } : {}),
    };

    if (query.search && query.search.length > 0) {
        where.OR = [
            { name: { contains: query.search, mode: "insensitive" } },
            { addressLine1: { contains: query.search, mode: "insensitive" } },
            { addressLine2: { contains: query.search, mode: "insensitive" } },
            { city: { contains: query.search, mode: "insensitive" } },
            { state: { contains: query.search, mode: "insensitive" } },
            { postalCode: { contains: query.search, mode: "insensitive" } },
            { country: { contains: query.search, mode: "insensitive" } },
        ];
    }

    const sortField = sortFieldMap[query.sortBy] ?? "createdAt";
    const orderBy: Prisma.ServiceLocationOrderByWithRelationInput[] = [
        { [sortField]: query.sortOrder },
        { id: "asc" },
    ];

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- Execute Parallel Count & FindMany ---
    const [total, records] = await Promise.all([
        prisma.serviceLocation.count({ where }),
        prisma.serviceLocation.findMany({
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
