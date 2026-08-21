import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { getAssetCategoriesQuerySchema } from "./assetCategory.schemas";
import type {
    AssetCategoryListResult,
    AssetCategoryViewModel,
} from "./assetCategory.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Transforms a Prisma AssetCategory record into AssetCategoryViewModel.
 */
export function toAssetCategoryViewModel(record: any): AssetCategoryViewModel {
    return {
        id: record.id,
        workspaceId: record.workspaceId,
        name: record.name,
        code: record.code ?? null,
        description: record.description ?? null,
        status: record.status,
        sortOrder: record.sortOrder,
        assetsCount: record._count?.assets ?? 0,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

/**
 * Retrieves a filtered, searched, sorted, and paginated list of AssetCategories for an authorized workspace.
 *
 * Security & Query Invariants (Phase 1.7.1 §6.3, §13.2):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC check: Caller must hold `PERMISSIONS.ASSETS_VIEW`.
 *   3. Parse and validate query input using `getAssetCategoriesQuerySchema`.
 *   4. Filters:
 *      - Tenant isolation: strictly filtered by `workspaceId`.
 *      - Status filter: "ACTIVE" (default), "INACTIVE", or "ALL".
 *      - Search filter: case-insensitive search across `name`, `code`, `description`.
 *   5. Sorting: `sortOrder`, `name`, `code`, `createdAt`, `updatedAt` with secondary sort `{ id: "asc" }`.
 *   6. Single query includes `_count: { select: { assets: true } }` to avoid N+1 query loops.
 *   7. Returns `AssetCategoryListResult`.
 */
export async function getAssetCategories(
    workspaceId: string,
    queryInput: unknown = {},
): Promise<AssetCategoryListResult> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce ASSETS_VIEW permission ---
    assertPermission(authorization.membership.role, PERMISSIONS.ASSETS_VIEW);

    // --- 3. Validate & Parse Query Options ---
    const query = getAssetCategoriesQuerySchema.parse(queryInput ?? {});

    // --- 4. Build Tenant-Scoped Where Filter ---
    const andClauses: Prisma.AssetCategoryWhereInput[] = [{ workspaceId }];

    if (query.status && query.status !== "ALL") {
        andClauses.push({ status: query.status });
    }

    if (query.search && query.search.length > 0) {
        andClauses.push({
            OR: [
                { name: { contains: query.search, mode: "insensitive" } },
                { code: { contains: query.search, mode: "insensitive" } },
                { description: { contains: query.search, mode: "insensitive" } },
            ],
        });
    }

    const where: Prisma.AssetCategoryWhereInput =
        andClauses.length === 1 ? andClauses[0] : { AND: andClauses };

    // --- 5. Build Deterministic Order By ---
    const sortField = query.sortBy ?? "sortOrder";
    const orderBy: Prisma.AssetCategoryOrderByWithRelationInput[] = [
        { [sortField]: query.sortOrder },
        { id: "asc" },
    ];

    // --- 6. Pagination Calculations ---
    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- 7. Parallel Execution of Count & FindMany ---
    const [total, records] = await Promise.all([
        prisma.assetCategory.count({ where }),
        prisma.assetCategory.findMany({
            where,
            orderBy,
            skip,
            take,
            include: {
                _count: {
                    select: {
                        assets: true,
                    },
                },
            },
        }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

    return {
        items: records.map(toAssetCategoryViewModel),
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

export const listAssetCategories = getAssetCategories;
