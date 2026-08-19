import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    getTechnicianWorkloadQuerySchema,
    type GetTechnicianWorkloadQueryInput,
} from "@/lib/validations/technicianAssignmentQuery";
import type {
    TechnicianWorkload,
    TechnicianAssignmentOverview,
} from "./technicianAssignmentOverview.types";

/**
 * Computes a technician's derived workload summary and metrics.
 *
 * Workload rules:
 *   - `ASSIGNED` is the only active workload status.
 *   - `CANCELLED` never contributes to active workload or scheduled minutes.
 *   - `COMPLETED` never contributes to current or upcoming workload or scheduled minutes.
 *   - `scheduledMinutes` calculates exact duration in minutes for `ASSIGNED` assignments.
 *   - Zero mutation side effects.
 */
export async function getTechnicianWorkload(
    workspaceId: string,
    technicianProfileId: string,
    options?: GetTechnicianWorkloadQueryInput,
): Promise<TechnicianWorkload | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Read Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Validate Query Options ---
    const query = getTechnicianWorkloadQuerySchema.parse(options ?? {});
    const now = query.now ?? new Date();

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
        return null;
    }

    // --- Fetch All Technician Assignments in Workspace ---
    const records = await prisma.technicianAssignment.findMany({
        where: {
            technicianProfileId: profile.id,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
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

    let currentAssignmentCount = 0;
    let upcomingAssignmentCount = 0;
    let activeAssignmentCount = 0;
    let completedAssignmentCount = 0;
    let cancelledAssignmentCount = 0;
    let scheduledAssignmentCount = 0;
    let scheduledMinutes = 0;

    const currentAssignments: TechnicianAssignmentOverview[] = [];
    const upcomingAssignments: TechnicianAssignmentOverview[] = [];

    const toOverview = (r: (typeof records)[number]): TechnicianAssignmentOverview => ({
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
    });

    for (const r of records) {
        if (r.status === "ASSIGNED") {
            const minutes = Math.round(
                (r.endsAt.getTime() - r.startsAt.getTime()) / 60000,
            );
            scheduledMinutes += Math.max(0, minutes);
            scheduledAssignmentCount += 1;
            activeAssignmentCount += 1;

            if (
                r.startsAt.getTime() <= now.getTime() &&
                now.getTime() < r.endsAt.getTime()
            ) {
                currentAssignmentCount += 1;
                currentAssignments.push(toOverview(r));
            } else if (r.startsAt.getTime() > now.getTime()) {
                upcomingAssignmentCount += 1;
                upcomingAssignments.push(toOverview(r));
            }
        } else if (r.status === "COMPLETED") {
            completedAssignmentCount += 1;
        } else if (r.status === "CANCELLED") {
            cancelledAssignmentCount += 1;
        }
    }

    return {
        technicianProfileId: profile.id,
        employeeId: profile.employee.id,
        currentAssignmentCount,
        upcomingAssignmentCount,
        activeAssignmentCount,
        completedAssignmentCount,
        cancelledAssignmentCount,
        scheduledAssignmentCount,
        scheduledMinutes,
        currentAssignments,
        upcomingAssignments,
    };
}
