import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { getServiceCatalogsQuerySchema } from "@/lib/validations/serviceCatalog";
import type {
    ServiceCatalogListResult,
    ServiceCatalogOperationalReadModel,
} from "./serviceCatalog.types";

/**
 * Lists paginated, filtered, and sorted ServiceCatalogs within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_VIEW permission.
 *   - Query is strictly tenant-scoped (`where: { workspaceId, ... }`).
 *   - Applies deterministic multi-column sorting (`sortOrder ASC, name ASC, id ASC`).
 *   - Returns operational read models with associated active/total work type counts.
 */
export async function getServiceCatalogs(
    workspaceId: string,
    queryInput: unknown = {},
): Promise<ServiceCatalogListResult> {
    // --- 1. Validate & Normalize Query Parameters ---
    const query = getServiceCatalogsQuerySchema.parse(queryInput);

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

    if (query.search) {
        where.OR = [
            {
                name: {
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
    const [total, catalogs] = await Promise.all([
        prisma.serviceCatalog.count({ where }),
        prisma.serviceCatalog.findMany({
            where,
            orderBy,
            skip,
            take,
            include: {
                _count: {
                    select: {
                        workTypes: true,
                    },
                },
                workTypes: {
                    where: {
                        status: "ACTIVE",
                    },
                    select: {
                        id: true,
                    },
                },
            },
        }),
    ]);

    const totalPages = Math.ceil(total / query.pageSize) || 0;

    const items: ServiceCatalogOperationalReadModel[] = catalogs.map((catalog) => ({
        id: catalog.id,
        workspaceId: catalog.workspaceId,
        name: catalog.name,
        description: catalog.description,
        status: catalog.status,
        sortOrder: catalog.sortOrder,
        workTypesCount: catalog._count.workTypes,
        activeWorkTypesCount: catalog.workTypes.length,
        createdAt: catalog.createdAt,
        updatedAt: catalog.updatedAt,
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
