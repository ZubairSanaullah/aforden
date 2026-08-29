import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { getAssetsQuerySchema } from "./asset.schemas";
import type { AssetListItem, AssetListResult } from "./asset.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Maps allowlisted sort fields to Prisma OrderBy inputs.
 */
const sortFieldMap: Record<string, keyof Prisma.AssetOrderByWithRelationInput> = {
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    name: "name",
    assetNumber: "assetNumber",
    serialNumber: "serialNumber",
    status: "status",
    manufacturer: "manufacturer",
};

/**
 * Transforms a Prisma Asset record with relations into lightweight AssetListItem.
 */
export function toAssetListItem(record: any): AssetListItem {
    return {
        id: record.id,
        workspaceId: record.workspaceId,
        assetNumber: record.assetNumber,
        name: record.name,
        status: record.status,

        manufacturer: record.manufacturer ?? null,
        modelNumber: record.modelNumber ?? null,
        serialNumber: record.serialNumber ?? null,
        subLocationNotes: record.subLocationNotes ?? null,

        tags: record.tags ?? [],

        customerId: record.customerId ?? null,
        customerName: record.customer?.name ?? null,
        customerNumber: record.customer?.customerNumber ?? null,

        locationId: record.locationId ?? null,
        locationName: record.location?.name ?? null,

        categoryId: record.categoryId ?? null,
        categoryName: record.category?.name ?? null,
        categoryCode: record.category?.code ?? null,

        warrantyExpiresAt: record.warrantyExpiresAt ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

/**
 * Retrieves a paginated, filtered, searched, and sorted directory of Assets within an authorized workspace.
 *
 * Security & Query Invariants (Phase 1.7.1 §10, §11, §12, §13):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC check: Caller must hold `PERMISSIONS.ASSETS_VIEW`.
 *   3. Parse and validate query parameters with `getAssetsQuerySchema`.
 *   4. Scoping & Filters:
 *      - Tenant isolation: strictly filtered by `workspaceId`.
 *      - TECHNICIAN role scoping (Phase 1.7.1 §11.2): Scoped to assets referenced by active WorkOrders
 *        (OPEN, ASSIGNED, IN_PROGRESS, ON_HOLD) assigned to the technician or at the technician's assigned active locations.
 *      - Direct filters: status, customerId, locationId, categoryId, manufacturer.
 *      - Tag filter: ANY-match array containment (`tags: { hasSome: query.tags }`) per Phase 1.7.1 §7.1.
 *      - Full-text multi-field search across: assetNumber, name, serialNumber, modelNumber, manufacturer,
 *        plus customer name and location name via relational joins.
 *   5. Sorting: strict allowlist (`createdAt`, `updatedAt`, `name`, `assetNumber`, `serialNumber`, `status`, `manufacturer`)
 *      with deterministic secondary sort `{ id: "asc" }`.
 *   6. Single-query execution: uses `include: { customer: true, location: true, category: true }` and `count({ where })`
 *      in parallel to prevent N+1 query loops.
 *   7. Returns `AssetListResult` containing `items` and complete `PaginationMetadata`.
 */
export async function getAssets(
    workspaceId: string,
    queryInput: unknown = {},
    actor?: WorkspaceAuthorizationContext,
): Promise<AssetListResult> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));
    const role = authorization.membership.role;

    // --- 2. RBAC Permission Assertion ---
    assertPermission(role, PERMISSIONS.ASSETS_VIEW);

    // --- 3. Validate & Parse Query Options ---
    const query = getAssetsQuerySchema.parse(queryInput ?? {});

    // --- 4. Build Tenant-Scoped Where Filter ---
    const andClauses: Prisma.AssetWhereInput[] = [{ workspaceId }];

    // Role-specific scoping for TECHNICIAN (Phase 1.7.1 §11.2)
    if (role === "TECHNICIAN") {
        andClauses.push({
            OR: [
                {
                    workOrders: {
                        some: {
                            workspaceId,
                            assignedTechnician: {
                                employee: {
                                    workspaceId,
                                    workspaceMemberId: authorization.membership.id,
                                },
                            },
                            status: {
                                in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"],
                            },
                        },
                    },
                },
                {
                    locationId: { not: null },
                    location: {
                        workOrders: {
                            some: {
                                workspaceId,
                                assignedTechnician: {
                                    employee: {
                                        workspaceId,
                                        workspaceMemberId: authorization.membership.id,
                                    },
                                },
                                status: {
                                    in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"],
                                },
                            },
                        },
                    },
                },
            ],
        });
    }

    // Status filter
    if (query.status) {
        andClauses.push({ status: query.status });
    }

    // Customer filter
    if (query.customerId) {
        andClauses.push({ customerId: query.customerId });
    }

    // Location filter
    if (query.locationId) {
        andClauses.push({ locationId: query.locationId });
    }

    // Category filter
    if (query.categoryId) {
        andClauses.push({ categoryId: query.categoryId });
    }

    // Manufacturer filter
    if (query.manufacturer) {
        andClauses.push({
            manufacturer: {
                contains: query.manufacturer,
                mode: "insensitive",
            },
        });
    }

    // Tags filter: ANY-match array containment (hasSome)
    if (query.tags && query.tags.length > 0) {
        andClauses.push({
            tags: {
                hasSome: query.tags,
            },
        });
    }

    // Search filter across core fields + relational customer/location names
    if (query.search && query.search.length > 0) {
        andClauses.push({
            OR: [
                { assetNumber: { contains: query.search, mode: "insensitive" } },
                { name: { contains: query.search, mode: "insensitive" } },
                { serialNumber: { contains: query.search, mode: "insensitive" } },
                { modelNumber: { contains: query.search, mode: "insensitive" } },
                { manufacturer: { contains: query.search, mode: "insensitive" } },
                { customer: { name: { contains: query.search, mode: "insensitive" } } },
                { location: { name: { contains: query.search, mode: "insensitive" } } },
            ],
        });
    }

    const where: Prisma.AssetWhereInput =
        andClauses.length === 1 ? andClauses[0] : { AND: andClauses };

    // --- 5. Build Deterministic Order By with Allowlisted Fields ---
    const sortField = sortFieldMap[query.sortBy] ?? "createdAt";
    const orderBy: Prisma.AssetOrderByWithRelationInput[] = [
        { [sortField]: query.sortOrder },
        { id: "asc" },
    ];

    // --- 6. Pagination Calculations ---
    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- 7. Parallel Execution of Count & FindMany (No N+1) ---
    const [total, records] = await Promise.all([
        prisma.asset.count({ where }),
        prisma.asset.findMany({
            where,
            orderBy,
            skip,
            take,
            include: {
                customer: true,
                location: true,
                category: true,
            },
        }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

    return {
        items: records.map(toAssetListItem),
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

export const listAssets = getAssets;
