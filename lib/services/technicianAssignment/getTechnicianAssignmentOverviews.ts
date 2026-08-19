import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    getTechnicianAssignmentOverviewsQuerySchema,
    type GetTechnicianAssignmentOverviewsQueryInput,
} from "@/lib/validations/technicianAssignmentQuery";
import type {
    TechnicianAssignmentOverview,
    TechnicianAssignmentOverviewListResult,
} from "./technicianAssignmentOverview.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves a filtered and paginated list of assignment overviews in an authenticated workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold assignment/dispatch authority (OWNER, ADMIN, MANAGER, or DISPATCHER).
 *   - Strictly scoped to the authenticated workspace.
 *   - Deterministically ordered by `startsAt ASC`, `endsAt ASC`, `id ASC`.
 *   - Excludes sensitive credentials.
 *   - Zero mutation side effects.
 */
export async function getTechnicianAssignmentOverviews(
    workspaceId: string,
    options?: GetTechnicianAssignmentOverviewsQueryInput,
): Promise<TechnicianAssignmentOverviewListResult> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Read Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Validate & Parse Query Options ---
    const query = getTechnicianAssignmentOverviewsQuerySchema.parse(
        options ?? {},
    );

    // --- Build Tenant-Scoped Query ---
    const employeeWhere: Prisma.EmployeeWhereInput = {
        workspaceId,
        ...(query.employeeId ? { id: query.employeeId } : {}),
    };

    if (query.search && query.search.length > 0) {
        employeeWhere.OR = [
            { displayName: { contains: query.search, mode: "insensitive" } },
            { employeeNumber: { contains: query.search, mode: "insensitive" } },
            { phone: { contains: query.search, mode: "insensitive" } },
        ];
    }

    const where: Prisma.TechnicianAssignmentWhereInput = {
        technicianProfile: {
            employee: employeeWhere,
            ...(query.technicianProfileId
                ? { id: query.technicianProfileId }
                : {}),
        },
        ...(query.status ? { status: query.status } : {}),
        ...(query.workType ? { workType: query.workType } : {}),
        ...(query.startsAt ? { startsAt: { gte: query.startsAt } } : {}),
        ...(query.endsAt ? { endsAt: { lte: query.endsAt } } : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- Execute Parallel Count & Select ---
    const [total, records] = await Promise.all([
        prisma.technicianAssignment.count({ where }),
        prisma.technicianAssignment.findMany({
            where,
            skip,
            take,
            orderBy: [
                { startsAt: "asc" },
                { endsAt: "asc" },
                { id: "asc" },
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
                updatedAt: true,
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

    const items: TechnicianAssignmentOverview[] = records.map((r) => ({
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
        notes: r.notes,
        completedAt: r.completedAt,
        cancelledAt: r.cancelledAt,
        cancellationReason: r.cancellationReason,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    }));

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
