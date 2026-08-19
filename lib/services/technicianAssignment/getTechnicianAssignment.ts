import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import type { TechnicianAssignment } from "./technicianAssignment.types";

/**
 * Retrieves a single technician assignment by ID within an authenticated workspace.
 */
export async function getTechnicianAssignment(
    workspaceId: string,
    assignmentId: string,
): Promise<TechnicianAssignment | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce View Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Tenant-Scoped Lookup ---
    const assignment = await prisma.technicianAssignment.findFirst({
        where: {
            id: assignmentId,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
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
    });

    if (!assignment) {
        return null;
    }

    return {
        id: assignment.id,
        technicianProfileId: assignment.technicianProfileId,
        employeeId: assignment.technicianProfile.employeeId,
        workType: assignment.workType,
        workReferenceId: assignment.workReferenceId,
        status: assignment.status,
        startsAt: assignment.startsAt,
        endsAt: assignment.endsAt,
        notes: assignment.notes,
        completedAt: assignment.completedAt,
        cancelledAt: assignment.cancelledAt,
        cancellationReason: assignment.cancellationReason,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
    };
}
