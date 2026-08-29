import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { getPartsQuerySchema } from "./part.schemas";
import type { PartListResult, PartDetailViewModel } from "./part.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Retrieves a paginated, filterable, searchable list of Parts in the authorized workspace.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.PARTS_VIEW.
 *   3. VALIDATION: Parse and sanitize query parameters.
 *   4. PERSISTENCE/RESOLUTION: Fetch matching parts with deterministic sorting (no N+1).
 *   5. READ MODEL: Map and return PartListResult with pagination metadata.
 */
export async function getParts(
    workspaceId: string,
    rawQuery?: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<PartListResult> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // --- 2. RBAC: Enforce PARTS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.PARTS_VIEW,
    );

    // --- 3. Validate Query Parameters ---
    const query = getPartsQuerySchema.parse(rawQuery ?? {});

    // --- 4. Build Query Filter ---
    const where: any = {
        workspaceId,
    };

    if (query.status) {
        where.status = query.status;
    }

    if (query.unitOfMeasure) {
        where.unitOfMeasure = query.unitOfMeasure;
    }

    if (query.search) {
        where.OR = [
            { name: { contains: query.search, mode: "insensitive" } },
            { sku: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
        ];
    }

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const [total, parts] = await Promise.all([
        prisma.part.count({ where }),
        prisma.part.findMany({
            where,
            skip,
            take,
            orderBy: [
                { [query.sortBy]: query.sortOrder },
                { id: "asc" },
            ],
        }),
    ]);

    const totalPages = Math.ceil(total / query.pageSize) || 1;

    // --- 5. Canonical Read Model Projection ---
    const items: PartDetailViewModel[] = parts.map((part) => ({
        id: part.id,
        workspaceId: part.workspaceId,
        name: part.name,
        sku: part.sku,
        description: part.description,
        unitOfMeasure: part.unitOfMeasure,
        unitCost: part.unitCost !== null ? Number(part.unitCost) : null,
        minimumStockLevel:
            part.minimumStockLevel !== null
                ? Number(part.minimumStockLevel)
                : null,
        status: part.status,
        createdAt: part.createdAt,
        updatedAt: part.updatedAt,
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
