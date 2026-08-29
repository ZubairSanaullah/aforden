import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    workOrderQuerySchema,
    type WorkOrderQueryInput,
} from "@/lib/validations/workOrder";
import { toWorkOrderReadModel } from "./getWorkOrder";
import type { WorkOrderListResult } from "./workOrder.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Maps allowlisted sort fields to Prisma OrderBy inputs.
 */
const sortFieldMap: Record<string, keyof Prisma.WorkOrderOrderByWithRelationInput> = {
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    workOrderNumber: "workOrderNumber",
    title: "title",
    status: "status",
    priority: "priority",
    estimatedDuration: "estimatedDuration",
};

/**
 * Retrieves a filtered, searched, sorted, and paginated list of WorkOrders within an authorized workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the WORK_ORDERS_VIEW permission.
 *   - TECHNICIAN role is scoped strictly to WorkOrders assigned to their technician profile.
 *   - All queries and counts are strictly tenant-scoped by `workspaceId`.
 *   - Search supports case-insensitive matching across `workOrderNumber`, `title`, `description`, customer name, and customer number.
 *   - Filters support `status`, `priority`, `customerId`, `locationId`, `workTypeId`, `assignedTechnicianId`.
 *   - Sorting uses a strict whitelist of known fields with deterministic `{ id: "asc" }` tie-breaking.
 *   - Single-query relation projection (`include: { customer: true, location: true, workType: true }`) avoids N+1 overhead.
 *   - Returns items along with complete PaginationMetadata.
 */
export async function getWorkOrders(
    workspaceId: string,
    queryInput: unknown = {},
    actor?: WorkspaceAuthorizationContext,
): Promise<WorkOrderListResult> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));
    const role = authorization.membership.role;

    // --- 2. RBAC: Enforce WORK_ORDERS_VIEW permission ---
    assertPermission(role, PERMISSIONS.WORK_ORDERS_VIEW);

    // --- 3. Validate & Parse Query Options ---
    const query = workOrderQuerySchema.parse(queryInput ?? {});

    // --- 4. Build Tenant-Scoped Where Filter ---
    const where: Prisma.WorkOrderWhereInput = {
        workspaceId,
    };

    // Role-specific scoping for TECHNICIAN
    if (role === "TECHNICIAN") {
        where.assignedTechnician = {
            employee: {
                workspaceId,
                workspaceMemberId: authorization.membership.id,
            },
        };
    }

    // Specific field filters
    if (query.customerId) {
        where.customerId = query.customerId;
    }

    if (query.locationId) {
        where.locationId = query.locationId;
    }

    if (query.workTypeId) {
        where.workTypeId = query.workTypeId;
    }

    if (query.assignedTechnicianId) {
        where.assignedTechnicianId = query.assignedTechnicianId;
    }

    if (query.status) {
        where.status = query.status;
    }

    if (query.priority) {
        where.priority = query.priority;
    }

    // Search filter across workOrderNumber, title, description, customer name/number
    if (query.search && query.search.length > 0) {
        where.OR = [
            { workOrderNumber: { contains: query.search, mode: "insensitive" } },
            { title: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
            { customer: { name: { contains: query.search, mode: "insensitive" } } },
            { customer: { customerNumber: { contains: query.search, mode: "insensitive" } } },
        ];
    }

    // --- 5. Build Deterministic Order By with Allowlisted Fields ---
    const sortField = sortFieldMap[query.sortBy] ?? "createdAt";
    const orderBy: Prisma.WorkOrderOrderByWithRelationInput[] = [
        { [sortField]: query.sortOrder },
        { id: "asc" },
    ];

    // --- 6. Pagination Calculations ---
    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- 7. Parallel Execution of Count & FindMany ---
    const [total, records] = await Promise.all([
        prisma.workOrder.count({ where }),
        prisma.workOrder.findMany({
            where,
            orderBy,
            skip,
            take,
            include: {
                customer: true,
                location: true,
                workType: true,
            },
        }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

    return {
        items: records.map(toWorkOrderReadModel),
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

export const listWorkOrders = getWorkOrders;
