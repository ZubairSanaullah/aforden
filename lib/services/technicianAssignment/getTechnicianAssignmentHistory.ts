import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    getTechnicianAssignmentHistoryQuerySchema,
    type GetTechnicianAssignmentHistoryQueryInput,
} from "@/lib/validations/technicianAssignmentHistory";
import type {
    TechnicianAssignmentHistoryItem,
    TechnicianAssignmentHistoryListResult,
} from "./technicianAssignmentHistory.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves paginated operational assignment history for a single technician within an authenticated workspace.
 *
 * Operational & Query guarantees:
 *   - Half-open interval date filtering `[from, to)`: `startsAt < to && endsAt > from`.
 *   - Deterministically sorted by `createdAt DESC`, `id DESC`.
 *   - `scheduledMinutes` calculates exact duration of each assignment in integer minutes.
 *   - Strictly tenant scoped through `technicianProfile.employee.workspaceId`.
 *   - Zero credential / authentication secret leakage.
 *   - Zero database mutations.
 */
export async function getTechnicianAssignmentHistory(
    workspaceId: string,
    technicianProfileId: string,
    options?: GetTechnicianAssignmentHistoryQueryInput,
): Promise<TechnicianAssignmentHistoryListResult> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Read Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Validate Query Options ---
    const query = getTechnicianAssignmentHistoryQuerySchema.parse(options ?? {});

    // --- Tenant-Scoped Lookup of Technician Profile ---
    const profile = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
        select: {
            id: true,
            employee: {
                select: {
                    id: true,
                    employeeNumber: true,
                    displayName: true,
                    phone: true,
                    status: true,
                },
            },
        },
    });

    if (!profile) {
        return {
            items: [],
            pagination: {
                page: query.page,
                pageSize: query.pageSize,
                total: 0,
                totalPages: 0,
                hasNextPage: false,
                hasPreviousPage: false,
            },
        };
    }

    // --- Build Tenant-Scoped Query Filter with Half-Open Overlap [from, to) ---
    const where: Prisma.TechnicianAssignmentWhereInput = {
        technicianProfileId: profile.id,
        technicianProfile: {
            employee: {
                workspaceId,
            },
        },
        ...(query.status ? { status: query.status } : {}),
        ...(query.workType ? { workType: query.workType } : {}),
        ...(query.workReferenceId
            ? { workReferenceId: query.workReferenceId }
            : {}),
        ...(query.from ? { endsAt: { gt: query.from } } : {}),
        ...(query.to ? { startsAt: { lt: query.to } } : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- Execute Parallel Count & FindMany ---
    const [total, records] = await Promise.all([
        prisma.technicianAssignment.count({ where }),
        prisma.technicianAssignment.findMany({
            where,
            skip,
            take,
            orderBy: [
                { createdAt: "desc" },
                { id: "desc" },
            ],
            select: {
                id: true,
                technicianProfileId: true,
                workType: true,
                workReferenceId: true,
                status: true,
                startsAt: true,
                endsAt: true,
                notes: true,
                completedAt: true,
                cancelledAt: true,
                cancellationReason: true,
                createdAt: true,
            },
        }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

    const items: TechnicianAssignmentHistoryItem[] = records.map((r) => {
        const scheduledMinutes = Math.max(
            0,
            Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60000),
        );

        return {
            id: r.id,
            technicianProfileId: r.technicianProfileId,
            employeeId: profile.employee.id,
            employee: {
                id: profile.employee.id,
                employeeNumber: profile.employee.employeeNumber,
                displayName: profile.employee.displayName,
                phone: profile.employee.phone,
                status: profile.employee.status,
            },
            workType: r.workType,
            workReferenceId: r.workReferenceId,
            status: r.status,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            scheduledMinutes,
            createdAt: r.createdAt,
            completedAt: r.completedAt,
            cancelledAt: r.cancelledAt,
            cancellationReason: r.cancellationReason,
            notes: r.notes,
        };
    });

    return {
        items,
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
