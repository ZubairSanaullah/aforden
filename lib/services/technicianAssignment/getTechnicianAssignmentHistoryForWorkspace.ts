import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    getWorkspaceTechnicianAssignmentHistoryQuerySchema,
    type GetWorkspaceTechnicianAssignmentHistoryQueryInput,
} from "@/lib/validations/technicianAssignmentHistory";
import type {
    TechnicianAssignmentHistoryItem,
    TechnicianAssignmentHistoryListResult,
} from "./technicianAssignmentHistory.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves paginated operational assignment history across all technicians within an authenticated workspace.
 *
 * Operational & Query guarantees:
 *   - Filters by `technicianProfileId`, `employeeId`, `status`, `workType`, `workReferenceId`, `from`, `to`.
 *   - Half-open interval date filtering `[from, to)`: `startsAt < to && endsAt > from`.
 *   - Deterministically sorted by `createdAt DESC`, `id DESC`.
 *   - `scheduledMinutes` calculates exact duration of each assignment in integer minutes.
 *   - Strictly tenant scoped.
 *   - Zero credential / authentication secret leakage.
 *   - Zero database mutations.
 */
export async function getTechnicianAssignmentHistoryForWorkspace(
    workspaceId: string,
    options?: GetWorkspaceTechnicianAssignmentHistoryQueryInput,
): Promise<TechnicianAssignmentHistoryListResult> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Read Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Validate Query Options ---
    const query =
        getWorkspaceTechnicianAssignmentHistoryQuerySchema.parse(options ?? {});

    // --- Build Tenant-Scoped Query Filter ---
    const where: Prisma.TechnicianAssignmentWhereInput = {
        technicianProfile: {
            employee: {
                workspaceId,
                ...(query.employeeId ? { id: query.employeeId } : {}),
            },
            ...(query.technicianProfileId
                ? { id: query.technicianProfileId }
                : {}),
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
                technicianProfile: {
                    select: {
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
                },
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
            employeeId: r.technicianProfile.employee.id,
            employee: {
                id: r.technicianProfile.employee.id,
                employeeNumber: r.technicianProfile.employee.employeeNumber,
                displayName: r.technicianProfile.employee.displayName,
                phone: r.technicianProfile.employee.phone,
                status: r.technicianProfile.employee.status,
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
