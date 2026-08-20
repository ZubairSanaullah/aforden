import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { getWorkTypesQuerySchema } from "@/lib/validations/workType";
import type {
    WorkTypeListResult,
    WorkTypeOperationalReadModel,
} from "./workType.types";

/**
 * Lists paginated, filtered, and sorted WorkTypes within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_VIEW permission.
 *   - Query is strictly tenant-scoped (`where: { workspaceId, ... }`).
 *   - If `catalogId` is provided, ensures it is scoped to the authorized `workspaceId`.
 *   - Applies deterministic multi-column sorting (`sortOrder ASC, name ASC, id ASC`).
 *   - Computes `isAvailableForWorkOrder` for each item.
 */
export async function getWorkTypes(
    workspaceId: string,
    queryInput: unknown = {},
): Promise<WorkTypeListResult> {
    // --- 1. Validate & Normalize Query Parameters ---
    const query = getWorkTypesQuerySchema.parse(queryInput);

    // --- 2. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 3. RBAC: Enforce SERVICE_CATALOG_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_VIEW,
    );

    // --- 4. Build Scoped Where Filter ---
    const where: any = {
        workspaceId,
    };

    if (query.status) {
        where.status = query.status;
    }

    if (query.catalogId) {
        where.catalogId = query.catalogId;
        where.catalog = {
            workspaceId,
        };
    }

    if (query.search) {
        where.OR = [
            {
                name: {
                    contains: query.search,
                    mode: "insensitive",
                },
            },
            {
                code: {
                    contains: query.search,
                    mode: "insensitive",
                },
            },
            {
                description: {
                    contains: query.search,
                    mode: "insensitive",
                },
            },
        ];
    }

    // --- 5. Build Deterministic Order By ---
    const orderBy: any[] = [];
    if (query.sortBy === "sortOrder") {
        orderBy.push({ sortOrder: query.sortOrder });
        orderBy.push({ name: "asc" });
        orderBy.push({ id: "asc" });
    } else if (query.sortBy === "name") {
        orderBy.push({ name: query.sortOrder });
        orderBy.push({ sortOrder: "asc" });
        orderBy.push({ id: "asc" });
    } else if (query.sortBy === "code") {
        orderBy.push({ code: query.sortOrder });
        orderBy.push({ name: "asc" });
        orderBy.push({ id: "asc" });
    } else if (query.sortBy === "estimatedDuration") {
        orderBy.push({ estimatedDuration: query.sortOrder });
        orderBy.push({ sortOrder: "asc" });
        orderBy.push({ id: "asc" });
    } else if (query.sortBy === "status") {
        orderBy.push({ status: query.sortOrder });
        orderBy.push({ sortOrder: "asc" });
        orderBy.push({ id: "asc" });
    } else if (query.sortBy === "createdAt") {
        orderBy.push({ createdAt: query.sortOrder });
        orderBy.push({ id: "asc" });
    } else if (query.sortBy === "updatedAt") {
        orderBy.push({ updatedAt: query.sortOrder });
        orderBy.push({ id: "asc" });
    } else {
        orderBy.push({ sortOrder: "asc" });
        orderBy.push({ name: "asc" });
        orderBy.push({ id: "asc" });
    }

    // --- 6. Pagination Calculations ---
    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- 7. Execute Queries ---
    const [total, workTypes] = await Promise.all([
        prisma.workType.count({ where }),
        prisma.workType.findMany({
            where,
            orderBy,
            skip,
            take,
            include: {
                catalog: true,
            },
        }),
    ]);

    const totalPages = Math.ceil(total / query.pageSize) || 0;

    const items: WorkTypeOperationalReadModel[] = workTypes.map((workType) => ({
        id: workType.id,
        workspaceId: workType.workspaceId,
        catalogId: workType.catalogId,
        catalogName: workType.catalog.name,
        catalogStatus: workType.catalog.status,
        name: workType.name,
        code: workType.code,
        description: workType.description,
        estimatedDuration: workType.estimatedDuration,
        status: workType.status,
        sortOrder: workType.sortOrder,
        isAvailableForWorkOrder:
            workType.status === "ACTIVE" &&
            workType.catalog.status === "ACTIVE",
        createdAt: workType.createdAt,
        updatedAt: workType.updatedAt,
    }));

    return {
        items,
        pagination: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            totalPages,
            hasNextPage: query.page < totalPages,
            hasPreviousPage: query.page > 1,
        },
    };
}
