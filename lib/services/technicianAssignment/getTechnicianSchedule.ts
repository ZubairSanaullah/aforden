import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    getTechnicianScheduleQuerySchema,
    type GetTechnicianScheduleQueryInput,
} from "@/lib/validations/technicianAssignmentQuery";
import type {
    TechnicianScheduleItem,
    TechnicianScheduleResult,
    AssignmentScheduleTemporalCategory,
} from "./technicianAssignmentOverview.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves a technician's schedule categorized into current, upcoming, and historical assignments.
 *
 * Temporal model:
 *   - Reference timestamp: `now` (defaults to current system time).
 *   - CURRENT: `startsAt <= now && now < endsAt`
 *   - UPCOMING: `startsAt > now`
 *   - HISTORICAL: `endsAt <= now`
 *
 * Security & Filter guarantees:
 *   - Strictly tenant scoped.
 *   - Authorized for OWNER, ADMIN, MANAGER, and DISPATCHER.
 *   - Cancelled assignments excluded unless explicitly requested via status filter.
 *   - Deterministically sorted by `startsAt ASC`, `endsAt ASC`, `id ASC`.
 */
export async function getTechnicianSchedule(
    workspaceId: string,
    technicianProfileId: string,
    options?: GetTechnicianScheduleQueryInput,
): Promise<TechnicianScheduleResult | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Assignment Read Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Validate & Parse Query Options ---
    const query = getTechnicianScheduleQuerySchema.parse(options ?? {});
    const now = query.now ?? new Date();

    // --- Tenant-Scoped Verification of Technician Profile ---
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
        return null;
    }

    // --- Build Query Filter ---
    const where: Prisma.TechnicianAssignmentWhereInput = {
        technicianProfileId: profile.id,
        technicianProfile: {
            employee: {
                workspaceId,
            },
        },
        ...(query.status
            ? { status: query.status }
            : { status: { not: "CANCELLED" } }),
        ...(query.startsAt ? { startsAt: { gte: query.startsAt } } : {}),
        ...(query.endsAt ? { endsAt: { lte: query.endsAt } } : {}),
    };

    const records = await prisma.technicianAssignment.findMany({
        where,
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
        },
    });

    const currentAssignments: TechnicianScheduleItem[] = [];
    const upcomingAssignments: TechnicianScheduleItem[] = [];
    const historicalAssignments: TechnicianScheduleItem[] = [];

    for (const r of records) {
        let temporalCategory: AssignmentScheduleTemporalCategory;

        if (r.startsAt.getTime() <= now.getTime() && now.getTime() < r.endsAt.getTime()) {
            temporalCategory = "CURRENT";
        } else if (r.startsAt.getTime() > now.getTime()) {
            temporalCategory = "UPCOMING";
        } else {
            temporalCategory = "HISTORICAL";
        }

        const item: TechnicianScheduleItem = {
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
            notes: r.notes,
            completedAt: r.completedAt,
            cancelledAt: r.cancelledAt,
            cancellationReason: r.cancellationReason,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            temporalCategory,
        };

        if (temporalCategory === "CURRENT") {
            currentAssignments.push(item);
        } else if (temporalCategory === "UPCOMING") {
            upcomingAssignments.push(item);
        } else {
            historicalAssignments.push(item);
        }
    }

    return {
        technicianProfileId: profile.id,
        employeeId: profile.employee.id,
        currentAssignments,
        upcomingAssignments,
        historicalAssignments,
        totalCount: records.length,
    };
}
