import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import type {
    TechnicianAssignment,
    TechnicianAssignmentFilterOptions,
    TechnicianAssignmentListResult,
} from "./technicianAssignment.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves a filtered and paginated list of technician assignments in an authenticated workspace.
 */
export async function getTechnicianAssignments(
    workspaceId: string,
    options?: TechnicianAssignmentFilterOptions,
): Promise<TechnicianAssignmentListResult> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce View Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: Prisma.TechnicianAssignmentWhereInput = {
        technicianProfile: {
            employee: {
                workspaceId,
            },
        },
        ...(options?.technicianProfileId
            ? { technicianProfileId: options.technicianProfileId }
            : {}),
        ...(options?.workType ? { workType: options.workType } : {}),
        ...(options?.workReferenceId
            ? { workReferenceId: options.workReferenceId }
            : {}),
        ...(options?.status ? { status: options.status } : {}),
        ...(options?.startsAt ? { startsAt: { gte: options.startsAt } } : {}),
        ...(options?.endsAt ? { endsAt: { lte: options.endsAt } } : {}),
    };

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
                        employeeId: true,
                    },
                },
            },
        }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    const items: TechnicianAssignment[] = records.map((r) => ({
        id: r.id,
        technicianProfileId: r.technicianProfileId,
        employeeId: r.technicianProfile.employeeId,
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
            page,
            pageSize,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1 && totalPages > 0,
        },
    };
}
