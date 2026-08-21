import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    listSchedulesQuerySchema,
    SCHEDULE_SORT_FIELDS,
} from "./schedule.schemas";
import {
    toScheduleAppointmentReadModel,
    SCHEDULE_APPOINTMENT_INCLUDE,
} from "./scheduleReadModel";
import type { ScheduleAppointmentListResult } from "./schedule.types";

/**
 * Lists and filters ScheduleAppointment records in a workspace with pagination and sorting.
 *
 * Query Features:
 * - Filtering: technicianId, workOrderId, customerId (via workOrder.customerId),
 *   locationId (via workOrder.locationId), status, dispatchStatus.
 * - Date Range: half-open interval overlap with [startDate, endDate).
 * - Full-Text / Search: searches appointmentNumber, notes, workOrderNumber, title, customer name, location name, technician name.
 * - Sorting: strictly allowlisted (scheduledStart, scheduledEnd, createdAt, updatedAt, status).
 * - Pagination: computes page, limit, total, totalPages, hasNextPage, hasPreviousPage.
 */
export async function listSchedules(
    workspaceId: string,
    rawQuery: unknown = {},
): Promise<ScheduleAppointmentListResult> {
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SCHEDULER_VIEW,
    );

    const query = listSchedulesQuerySchema.parse(rawQuery);

    const whereClause: Record<string, any> = {
        workspaceId,
    };

    if (query.technicianId) {
        whereClause.technicianId = query.technicianId;
    }

    if (query.workOrderId) {
        whereClause.workOrderId = query.workOrderId;
    }

    if (query.status) {
        whereClause.status = query.status;
    }

    if (query.dispatchStatus) {
        whereClause.dispatchStatus = query.dispatchStatus;
    }

    // Customer / Location traversal through WorkOrder relation
    if (query.customerId || query.locationId) {
        whereClause.workOrder = {};
        if (query.customerId) {
            whereClause.workOrder.customerId = query.customerId;
        }
        if (query.locationId) {
            whereClause.workOrder.locationId = query.locationId;
        }
    }

    // Date Range filtering using canonical half-open interval overlap
    if (query.startDate && query.endDate) {
        whereClause.scheduledStart = { lt: query.endDate };
        whereClause.scheduledEnd = { gt: query.startDate };
    } else if (query.startDate) {
        whereClause.scheduledEnd = { gt: query.startDate };
    } else if (query.endDate) {
        whereClause.scheduledStart = { lt: query.endDate };
    }

    // Search query across appointment, work order, customer, location, and technician
    if (query.search) {
        const searchTerm = query.search;
        whereClause.OR = [
            { appointmentNumber: { contains: searchTerm, mode: "insensitive" } },
            { notes: { contains: searchTerm, mode: "insensitive" } },
            {
                workOrder: {
                    workOrderNumber: { contains: searchTerm, mode: "insensitive" },
                },
            },
            {
                workOrder: {
                    title: { contains: searchTerm, mode: "insensitive" },
                },
            },
            {
                workOrder: {
                    customer: {
                        name: { contains: searchTerm, mode: "insensitive" },
                    },
                },
            },
            {
                workOrder: {
                    location: {
                        name: { contains: searchTerm, mode: "insensitive" },
                    },
                },
            },
            {
                technician: {
                    employee: {
                        displayName: { contains: searchTerm, mode: "insensitive" },
                    },
                },
            },
        ];
    }

    // Allowlist sort field validation
    const sortField = SCHEDULE_SORT_FIELDS.includes(query.sortBy as any)
        ? query.sortBy
        : "scheduledStart";
    const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";

    const skip = (query.page - 1) * query.limit;
    const take = query.limit;

    const [items, total] = await Promise.all([
        prisma.scheduleAppointment.findMany({
            where: whereClause,
            include: SCHEDULE_APPOINTMENT_INCLUDE,
            orderBy: {
                [sortField]: sortOrder,
            },
            skip,
            take,
        }),
        prisma.scheduleAppointment.count({
            where: whereClause,
        }),
    ]);

    const totalPages = Math.ceil(total / query.limit) || 1;

    return {
        items: items.map(toScheduleAppointmentReadModel),
        pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages,
            hasNextPage: query.page < totalPages,
            hasPreviousPage: query.page > 1,
        },
    };
}
