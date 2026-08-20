import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { workOrderHistoryQuerySchema } from "@/lib/validations/workOrder";
import { WorkOrderNotFoundError } from "./workOrderErrors";
import type {
    WorkOrderHistoryReadModel,
    WorkOrderHistoryListResult,
    WorkOrderHistoryEventType,
} from "./workOrder.types";

/**
 * Projects a raw Prisma WorkOrderHistory record into the canonical WorkOrderHistoryReadModel.
 */
export function toWorkOrderHistoryReadModel(
    record: any,
): WorkOrderHistoryReadModel {
    let parsedMetadata: Record<string, any> | null = null;
    if (record.metadata) {
        try {
            parsedMetadata = JSON.parse(record.metadata);
        } catch {
            parsedMetadata = null;
        }
    }

    return {
        id: record.id,
        workspaceId: record.workspaceId,
        workOrderId: record.workOrderId,
        eventType: record.eventType as WorkOrderHistoryEventType,
        actorMemberId: record.actorMemberId ?? null,
        actorName: record.actorName ?? null,
        field: record.field ?? null,
        oldValue: record.oldValue ?? null,
        newValue: record.newValue ?? null,
        metadata: parsedMetadata,
        createdAt: record.createdAt,
    };
}

/**
 * Retrieves the operational history and audit timeline of a WorkOrder.
 *
 * Locked Execution Order (Phase 1.6.12):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC Permission Check (`assertPermission(role, PERMISSIONS.WORK_ORDERS_VIEW)`).
 *   3. Validate Query Parameters (`workOrderHistoryQuerySchema.parse(queryInput ?? {})`).
 *   4. Scoped Target Resolution & Technician Visibility Boundary:
 *      - Target WorkOrder/History must be strictly tenant-scoped (`workspaceId`).
 *      - TECHNICIAN role can only view history for WorkOrders assigned to their profile.
 *      - Cross-tenant or non-existent WorkOrders throw `WorkOrderNotFoundError` (404).
 *   5. Deterministic Paginated History Retrieval (ordered by `createdAt`, `id`).
 *   6. Project and return standard canonical `WorkOrderHistoryListResult`.
 */
export async function getWorkOrderHistory(
    workspaceId: string,
    workOrderId: string,
    queryInput?: unknown,
): Promise<WorkOrderHistoryListResult> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    const role = authorization.membership.role;

    // --- 2. RBAC Permission Check ---
    assertPermission(role, PERMISSIONS.WORK_ORDERS_VIEW);

    // --- 3. Validate Query Parameters ---
    const query = workOrderHistoryQuerySchema.parse(queryInput ?? {});

    // --- 4. Scoped Target Resolution & Technician Visibility Boundary ---
    const existingWo = await prisma.workOrder.findFirst({
        where: {
            id: workOrderId,
            workspaceId,
        },
    });

    if (role === "TECHNICIAN") {
        const callerProfile = await prisma.technicianProfile.findFirst({
            where: {
                employee: {
                    workspaceMemberId: authorization.membership.id,
                    workspaceId,
                },
            },
        });

        if (!callerProfile) {
            throw new ForbiddenError(
                "Active technician profile is required to view work order history.",
            );
        }

        if (existingWo) {
            if (existingWo.assignedTechnicianId !== callerProfile.id) {
                throw new ForbiddenError(
                    "Technicians can only view history for work orders assigned to them.",
                );
            }
        } else {
            // Check if deleted work order belonged to this workspace and had history assigned to caller
            const historyCount = await prisma.workOrderHistory.count({
                where: {
                    workspaceId,
                    workOrderId,
                },
            });

            if (historyCount === 0) {
                throw new WorkOrderNotFoundError();
            }

            const wasAssigned = await prisma.workOrderHistory.findFirst({
                where: {
                    workspaceId,
                    workOrderId,
                    eventType: { in: ["ASSIGNED", "REASSIGNED"] },
                    newValue: callerProfile.id,
                },
            });

            if (!wasAssigned) {
                throw new ForbiddenError(
                    "Technicians can only view history for work orders assigned to them.",
                );
            }
        }
    } else {
        if (!existingWo) {
            // If physically deleted, check if history exists for this workspace + workOrderId
            const historyCount = await prisma.workOrderHistory.count({
                where: {
                    workspaceId,
                    workOrderId,
                },
            });

            if (historyCount === 0) {
                throw new WorkOrderNotFoundError();
            }
        }
    }

    // --- 5. Retrieve Paginated History ---
    const where: any = {
        workspaceId,
        workOrderId,
    };

    if (query.eventType) {
        where.eventType = query.eventType;
    }

    const total = await prisma.workOrderHistory.count({ where });
    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;
    const totalPages = Math.ceil(total / query.pageSize);

    const records = await prisma.workOrderHistory.findMany({
        where,
        skip,
        take,
        orderBy: [
            { createdAt: query.sortOrder ?? "desc" },
            { id: query.sortOrder ?? "desc" },
        ],
    });

    return {
        items: records.map(toWorkOrderHistoryReadModel),
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
