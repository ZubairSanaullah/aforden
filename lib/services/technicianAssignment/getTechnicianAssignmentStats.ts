import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    getTechnicianAssignmentStatsQuerySchema,
    type GetTechnicianAssignmentStatsQueryInput,
} from "@/lib/validations/technicianAssignmentQuery";
import type {
    TechnicianAssignmentStats,
    TechnicianAssignmentStatsByTechnician,
} from "./technicianAssignmentOverview.types";
import type { AssignmentWorkType, Prisma } from "@/generated/prisma/client";

/**
 * Computes workspace-level assignment statistics and breakdown.
 *
 * Security & Isolation guarantees:
 *   - Strictly scoped to target workspace.
 *   - Authorized for OWNER, ADMIN, MANAGER, and DISPATCHER.
 *   - `byTechnician` sorted by `displayName ASC`, `employeeId ASC`, `technicianProfileId ASC`.
 *   - `scheduledMinutes` sums exact duration of `ASSIGNED` status records only.
 *   - Excludes credentials/tokens.
 *   - Zero mutation side effects.
 */
export async function getTechnicianAssignmentStats(
    workspaceId: string,
    options?: GetTechnicianAssignmentStatsQueryInput,
): Promise<TechnicianAssignmentStats> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Read Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Validate Query Options ---
    const query = getTechnicianAssignmentStatsQuerySchema.parse(options ?? {});
    const now = query.now ?? new Date();

    // --- Build Tenant-Scoped Query Filter ---
    const where: Prisma.TechnicianAssignmentWhereInput = {
        technicianProfile: {
            employee: {
                workspaceId,
            },
            ...(query.technicianProfileId
                ? { id: query.technicianProfileId }
                : {}),
        },
        ...(query.workType ? { workType: query.workType } : {}),
        ...(query.startsAt ? { startsAt: { gte: query.startsAt } } : {}),
        ...(query.endsAt ? { endsAt: { lte: query.endsAt } } : {}),
    };

    // --- Execute Parallel Query for Assignments and Technicians ---
    const [assignments, technicians] = await Promise.all([
        prisma.technicianAssignment.findMany({
            where,
            select: {
                id: true,
                technicianProfileId: true,
                workType: true,
                status: true,
                startsAt: true,
                endsAt: true,
            },
        }),
        prisma.technicianProfile.findMany({
            where: {
                employee: {
                    workspaceId,
                },
            },
            select: {
                id: true,
                employeeId: true,
                employee: {
                    select: {
                        displayName: true,
                    },
                },
            },
        }),
    ]);

    let total = assignments.length;
    let assigned = 0;
    let cancelled = 0;
    let completed = 0;
    let current = 0;
    let upcoming = 0;
    let scheduledMinutes = 0;

    const byWorkType: Record<AssignmentWorkType, number> = {
        WORK: 0,
    };

    const techCountsMap = new Map<string, number>();

    for (const a of assignments) {
        if (a.status === "ASSIGNED") {
            assigned += 1;
            const duration = Math.round(
                (a.endsAt.getTime() - a.startsAt.getTime()) / 60000,
            );
            scheduledMinutes += Math.max(0, duration);

            if (a.startsAt.getTime() <= now.getTime() && now.getTime() < a.endsAt.getTime()) {
                current += 1;
            } else if (a.startsAt.getTime() > now.getTime()) {
                upcoming += 1;
            }
        } else if (a.status === "CANCELLED") {
            cancelled += 1;
        } else if (a.status === "COMPLETED") {
            completed += 1;
        }

        if (byWorkType[a.workType] !== undefined) {
            byWorkType[a.workType] += 1;
        } else {
            byWorkType[a.workType] = 1;
        }

        techCountsMap.set(
            a.technicianProfileId,
            (techCountsMap.get(a.technicianProfileId) ?? 0) + 1,
        );
    }

    // Build byTechnician breakdown
    const byTechnician: TechnicianAssignmentStatsByTechnician[] = technicians.map(
        (t) => ({
            technicianProfileId: t.id,
            employeeId: t.employeeId,
            displayName: t.employee.displayName,
            count: techCountsMap.get(t.id) ?? 0,
        }),
    );

    // Sort deterministically (displayName ASC, employeeId ASC, technicianProfileId ASC)
    byTechnician.sort((a, b) => {
        const nameCmp = (a.displayName ?? "").localeCompare(b.displayName ?? "");
        if (nameCmp !== 0) return nameCmp;
        const empCmp = a.employeeId.localeCompare(b.employeeId);
        if (empCmp !== 0) return empCmp;
        return a.technicianProfileId.localeCompare(b.technicianProfileId);
    });

    return {
        total,
        assigned,
        cancelled,
        completed,
        byWorkType,
        byTechnician,
        current,
        upcoming,
        scheduledMinutes,
    };
}
