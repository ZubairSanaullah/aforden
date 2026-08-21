import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { getAssetHistoryQuerySchema } from "./asset.schemas";
import { AssetNotFoundError } from "./assetErrors";
import type {
    AssetHistoryListResult,
    AssetHistoryReadModel,
} from "./asset.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Projects a raw Prisma AssetHistory record with included actorUser into canonical AssetHistoryReadModel.
 */
export function toAssetHistoryReadModel(record: any): AssetHistoryReadModel {
    const actor = record.actorUser
        ? {
              id: record.actorUser.id,
              name: record.actorUser.name || record.actorUser.email || "Unknown User",
              email: record.actorUser.email ?? null,
          }
        : {
              id: null,
              name: "Deleted User",
              email: null,
          };

    return {
        id: record.id,
        workspaceId: record.workspaceId,
        assetId: record.assetId,
        eventType: record.eventType,
        actorUserId: record.actorUserId ?? null,
        actorRole: record.actorRole,
        actorName: actor.name,
        actor,
        reason: record.reason ?? null,
        metadata: (record.metadata as Record<string, any>) ?? null,
        createdAt: record.createdAt,
    };
}

/**
 * Retrieves the paginated operational history and audit ledger timeline of an Asset within an authorized workspace.
 *
 * Security & Scoping Invariants (Phase 1.7.1 §8, §10, §11.2, §13.1 & Phase 1.7.10):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC check: Caller must hold `PERMISSIONS.ASSETS_VIEW`.
 *   3. Parse and validate query options using `getAssetHistoryQuerySchema`.
 *   4. Scoped Target Resolution & Technician Visibility Boundary:
 *      - Locate target Asset in workspace (throws 404 `AssetNotFoundError` if missing or cross-tenant).
 *      - TECHNICIAN role scoping (consistent with 1.7.8 getAsset): A technician can view history if and only if
 *        assigned to an active WorkOrder (OPEN, ASSIGNED, IN_PROGRESS, ON_HOLD) referencing this assetId or the asset's locationId.
 *   5. Build Tenant-Scoped Where Filter:
 *      - Filter by `workspaceId`, `assetId`.
 *      - Optional `eventType` filter (supports single event or array of events).
 *   6. Single-query execution with `include: { actorUser: { select: { id: true, name: true, email: true } } }`
 *      ordered by `createdAt` descending (and secondary `{ id: "desc" }`).
 *   7. Returns `AssetHistoryListResult` containing `items` and complete `PaginationMetadata`.
 */
export async function getAssetHistory(
    workspaceId: string,
    assetId: string,
    queryInput: unknown = {},
): Promise<AssetHistoryListResult> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    const role = authorization.membership.role;

    // --- 2. RBAC Permission Assertion ---
    assertPermission(role, PERMISSIONS.ASSETS_VIEW);

    // --- 3. Validate Query Parameters ---
    const query = getAssetHistoryQuerySchema.parse(queryInput ?? {});

    // --- 4. Scoped Target Resolution & Technician Visibility Boundary ---
    const asset = await prisma.asset.findFirst({
        where: {
            id: assetId,
            workspaceId,
        },
    });

    if (!asset) {
        throw new AssetNotFoundError();
    }

    // Role-specific scoping for TECHNICIAN (Phase 1.7.1 §11.2 & Phase 1.7.8 precedent)
    if (role === "TECHNICIAN") {
        const callerProfile = await prisma.technicianProfile.findFirst({
            where: {
                employee: {
                    workspaceId,
                    workspaceMemberId: authorization.membership.id,
                },
            },
            select: { id: true },
        });

        if (!callerProfile) {
            throw new AssetNotFoundError();
        }

        const activeAssignment = await prisma.workOrder.findFirst({
            where: {
                workspaceId,
                assignedTechnicianId: callerProfile.id,
                status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
                OR: [
                    { assetId: asset.id },
                    ...(asset.locationId ? [{ locationId: asset.locationId }] : []),
                ],
            },
            select: { id: true },
        });

        if (!activeAssignment) {
            throw new AssetNotFoundError();
        }
    }

    // --- 5. Build History Query Where Filter ---
    const where: Prisma.AssetHistoryWhereInput = {
        workspaceId,
        assetId,
    };

    if (query.eventType) {
        if (Array.isArray(query.eventType)) {
            where.eventType = { in: query.eventType };
        } else {
            where.eventType = query.eventType;
        }
    }

    // --- 6. Ordering & Pagination Calculations ---
    const sortOrder = query.sortOrder ?? "desc";
    const orderBy: Prisma.AssetHistoryOrderByWithRelationInput[] = [
        { createdAt: sortOrder },
        { id: sortOrder },
    ];

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- 7. Parallel Execution of Count & FindMany ---
    const [total, records] = await Promise.all([
        prisma.assetHistory.count({ where }),
        prisma.assetHistory.findMany({
            where,
            orderBy,
            skip,
            take,
            include: {
                actorUser: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
        }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

    return {
        items: records.map(toAssetHistoryReadModel),
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
