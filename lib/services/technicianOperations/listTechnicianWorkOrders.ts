import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { toWorkOrderReadModel } from "@/lib/services/workOrder/getWorkOrder";
import {
    technicianWorkOrderQuerySchema,
    type TechnicianExecutionContext,
    type TechnicianWorkOrderListResult,
} from "./technicianOperations.types";
import type { Prisma, MembershipRole } from "@/generated/prisma/client";

const ALLOWED_ROLES: MembershipRole[] = [
    "OWNER",
    "ADMIN",
    "MANAGER",
    "DISPATCHER",
    "TECHNICIAN",
];

const sortFieldMap: Record<string, keyof Prisma.WorkOrderOrderByWithRelationInput> = {
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    workOrderNumber: "workOrderNumber",
    title: "title",
    status: "status",
    priority: "priority",
    estimatedDuration: "estimatedDuration",
    startedAt: "startedAt",
    completedAt: "completedAt",
};

/**
 * Retrieves the assigned work orders for the authenticated technician context.
 *
 * Invariant & Security Guarantees:
 * - RBAC: OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN are authorized. ACCOUNTANT throws ForbiddenError (403).
 * - Invariant 3 (Tenant & Technician Isolation):
 *   - For TECHNICIAN role: Query is strictly scoped to `workspaceId === context.workspaceId` AND
 *     `assignedTechnicianId === context.technicianProfileId`.
 *   - For administrative roles: Query is scoped to `workspaceId === context.workspaceId` and optionally
 *     filtered by `assignedTechnicianId` if provided.
 * - Single-query relation projection avoids N+1 and prevents raw Prisma model leakage.
 */
export async function listTechnicianWorkOrders(
    context: TechnicianExecutionContext,
    queryInput: unknown = {}
): Promise<TechnicianWorkOrderListResult> {
    // 1. RBAC Authorization Check (Section 11)
    if (!ALLOWED_ROLES.includes(context.role)) {
        throw new ForbiddenError("You do not have permission to access the technician work queue.");
    }

    // 2. Validate Query Options
    const query = technicianWorkOrderQuerySchema.parse(queryInput ?? {});

    // 3. Build Tenant & Technician Scoped Where Filter (Section 2.3)
    const where: Prisma.WorkOrderWhereInput = {
        workspaceId: context.workspaceId,
    };

    if (context.role === "TECHNICIAN") {
        where.assignedTechnicianId = context.technicianProfileId;
    } else if (query.assignedTechnicianId) {
        where.assignedTechnicianId = query.assignedTechnicianId;
    }

    // Field filters
    if (query.status) {
        where.status = query.status;
    }

    if (query.priority) {
        where.priority = query.priority;
    }

    if (query.customerId) {
        where.customerId = query.customerId;
    }

    if (query.locationId) {
        where.locationId = query.locationId;
    }

    if (query.workTypeId) {
        where.workTypeId = query.workTypeId;
    }

    // Substring search
    if (query.search && query.search.length > 0) {
        where.OR = [
            { workOrderNumber: { contains: query.search, mode: "insensitive" } },
            { title: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
            { customer: { name: { contains: query.search, mode: "insensitive" } } },
            { customer: { customerNumber: { contains: query.search, mode: "insensitive" } } },
        ];
    }

    // 4. Deterministic Order By with Whitelisted Fields
    const sortField = sortFieldMap[query.sortBy] ?? "createdAt";
    const orderBy: Prisma.WorkOrderOrderByWithRelationInput[] = [
        { [sortField]: query.sortOrder },
        { id: "asc" },
    ];

    // 5. Pagination
    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // 6. Execute Count & Query in Parallel
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
