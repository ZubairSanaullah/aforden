import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { getInventoryLocationsQuerySchema } from "./inventoryLocation.schemas";
import type {
    InventoryLocationDetailViewModel,
    InventoryLocationListResult,
} from "./inventoryLocation.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves a paginated list of InventoryLocations in a workspace with filtering and searching.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_LOCATIONS_VIEW.
 *   3. VALIDATION: Parse and apply defaults to search, filter, and pagination parameters.
 *   4. PERSISTENCE: Query database with tenant isolation and compound deterministic sort.
 *   5. READ MODEL: Project into InventoryLocationListResult.
 */
export async function getInventoryLocations(
    workspaceId: string,
    rawQuery: unknown = {},
): Promise<InventoryLocationListResult> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_LOCATIONS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_LOCATIONS_VIEW,
    );

    // --- 3. Validate Query Parameters ---
    const query = getInventoryLocationsQuerySchema.parse(rawQuery);

    const {
        search,
        status,
        locationType,
        technicianProfileId,
        page,
        pageSize,
        sortBy,
        sortOrder,
    } = query;

    // --- 4. Build Scoped Prisma Where Clause ---
    const where: Prisma.InventoryLocationWhereInput = {
        workspaceId,
    };

    if (status) {
        where.status = status;
    }

    if (locationType) {
        where.locationType = locationType;
    }

    if (technicianProfileId) {
        where.technicianProfileId = technicianProfileId;
    }

    if (search && search.length > 0) {
        where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
        ];
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const [items, total] = await Promise.all([
        prisma.inventoryLocation.findMany({
            where,
            skip,
            take,
            orderBy: [
                { [sortBy]: sortOrder },
                { id: "asc" },
            ],
        }),
        prisma.inventoryLocation.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // --- 5. Canonical Read Model Projection ---
    const projectedItems: InventoryLocationDetailViewModel[] = items.map(
        (loc) => ({
            id: loc.id,
            workspaceId: loc.workspaceId,
            name: loc.name,
            code: loc.code,
            locationType: loc.locationType,
            technicianProfileId: loc.technicianProfileId,
            addressLine1: loc.addressLine1,
            addressLine2: loc.addressLine2,
            city: loc.city,
            state: loc.state,
            postalCode: loc.postalCode,
            country: loc.country,
            notes: loc.notes,
            status: loc.status,
            createdAt: loc.createdAt,
            updatedAt: loc.updatedAt,
        }),
    );

    return {
        items: projectedItems,
        pagination: {
            page,
            pageSize,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
        },
    };
}
