import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    workOrderQuerySchema,
} from "@/lib/validations/workOrder";
import { toWorkOrderReadModel } from "@/lib/services/workOrder/getWorkOrder";
import { AssetNotFoundError } from "./assetErrors";
import type { WorkOrderListResult } from "@/lib/services/workOrder/workOrder.types";
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
 * Retrieves a paginated list of WorkOrders associated with a specific Asset (Phase 1.7.7 §9.3 & §15).
 *
 * Security & Tenant Isolation:
 *   1. Authenticates session and enforces WORK_ORDERS_VIEW or ASSETS_VIEW permission.
 *   2. Resolves target Asset with (id: assetId, workspaceId). Throws AssetNotFoundError (404) if missing.
 *   3. Scopes WorkOrder query strictly to { workspaceId, assetId: asset.id }.
 *   4. If caller is TECHNICIAN: strictly filters to WorkOrders assigned to their profile.
 *   5. Supports filtering by status, priority, text search, sorting, and pagination.
 *   6. Returns canonical WorkOrderListResult matching Phase 1.6 read models.
 */
export async function getAssetWorkOrders(
    workspaceId: string,
    assetId: string,
    queryInput: unknown = {},
): Promise<WorkOrderListResult> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    const role = authorization.membership.role;

    // --- 2. RBAC: Enforce WORK_ORDERS_VIEW permission ---
    assertPermission(role, PERMISSIONS.WORK_ORDERS_VIEW);

    // --- 3. Validate & Parse Query Options ---
    const query = workOrderQuerySchema.parse(queryInput ?? {});

    // --- 4. Resolve Target Asset (IDOR Tenant Protection) ---
    const asset = await prisma.asset.findFirst({
        where: {
            id: assetId,
            workspaceId,
        },
        select: {
            id: true,
        },
    });

    if (!asset) {
        throw new AssetNotFoundError();
    }

    // --- 5. Build Tenant-Scoped Where Filter ---
    const where: Prisma.WorkOrderWhereInput = {
        workspaceId,
        assetId: asset.id,
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

    // --- 6. Build Deterministic Order By with Allowlisted Fields ---
    const sortField = sortFieldMap[query.sortBy] ?? "createdAt";
    const orderBy: Prisma.WorkOrderOrderByWithRelationInput[] = [
        { [sortField]: query.sortOrder },
        { id: "asc" },
    ];

    // --- 7. Pagination Calculations ---
    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- 8. Parallel Execution of Count & FindMany ---
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
            hasPreviousPage: query.page > 1,
        },
    };
}
