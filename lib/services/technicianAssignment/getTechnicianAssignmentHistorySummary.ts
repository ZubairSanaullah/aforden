import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    getTechnicianAssignmentHistorySummaryQuerySchema,
    type GetTechnicianAssignmentHistorySummaryQueryInput,
} from "@/lib/validations/technicianAssignmentHistory";
import type { TechnicianAssignmentHistorySummary } from "./technicianAssignmentHistory.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Computes aggregate summary metrics of technician assignments across a workspace or filtered subset.
 *
 * Operational & Metric guarantees:
 *   - Interval date filtering uses half-open interval overlap `[from, to)`: `startsAt < to && endsAt > from`.
 *   - `totalScheduledMinutes`: Sum of scheduled duration for all matching assignments.
 *   - `completedScheduledMinutes`: Sum of scheduled duration for COMPLETED assignments.
 *   - `cancelledScheduledMinutes`: Sum of scheduled duration for CANCELLED assignments.
 *   - `assignedCount`, `completedCount`, `cancelledCount`: Exact status counts.
 *   - Strictly tenant scoped.
 *   - Zero database mutations.
 */
export async function getTechnicianAssignmentHistorySummary(
    workspaceId: string,
    options?: GetTechnicianAssignmentHistorySummaryQueryInput,
): Promise<TechnicianAssignmentHistorySummary> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Read Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Validate Query Options ---
    const query =
        getTechnicianAssignmentHistorySummaryQuerySchema.parse(options ?? {});

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
        ...(query.workType ? { workType: query.workType } : {}),
        ...(query.from ? { endsAt: { gt: query.from } } : {}),
        ...(query.to ? { startsAt: { lt: query.to } } : {}),
    };

    const records = await prisma.technicianAssignment.findMany({
        where,
        select: {
            id: true,
            status: true,
            startsAt: true,
            endsAt: true,
        },
    });

    let assignedCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let totalScheduledMinutes = 0;
    let completedScheduledMinutes = 0;
    let cancelledScheduledMinutes = 0;

    for (const r of records) {
        const duration = Math.max(
            0,
            Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60000),
        );

        totalScheduledMinutes += duration;

        if (r.status === "ASSIGNED") {
            assignedCount += 1;
        } else if (r.status === "COMPLETED") {
            completedCount += 1;
            completedScheduledMinutes += duration;
        } else if (r.status === "CANCELLED") {
            cancelledCount += 1;
            cancelledScheduledMinutes += duration;
        }
    }

    return {
        totalAssignments: records.length,
        assignedCount,
        completedCount,
        cancelledCount,
        totalScheduledMinutes,
        completedScheduledMinutes,
        cancelledScheduledMinutes,
    };
}
