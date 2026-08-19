import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import type { TechnicianAssignmentOverview } from "./technicianAssignmentOverview.types";

/**
 * Retrieves a single complete assignment projection including employee metadata.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold assignment/dispatch authority (OWNER, ADMIN, MANAGER, or DISPATCHER).
 *   - Scoped strictly by `technicianProfile.employee.workspaceId === workspaceId`.
 *   - Returns null if not found or if belonging to another workspace.
 *   - Excludes sensitive authentication credentials/tokens.
 *   - Zero mutation side effects.
 */
export async function getTechnicianAssignmentOverview(
    workspaceId: string,
    assignmentId: string,
): Promise<TechnicianAssignmentOverview | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Assignment Read Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Tenant-Scoped Lookup ---
    const record = await prisma.technicianAssignment.findFirst({
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
    });

    if (!record) {
        return null;
    }

    return {
        id: record.id,
        technicianProfileId: record.technicianProfileId,
        employeeId: record.technicianProfile.employee.id,
        employee: {
            id: record.technicianProfile.employee.id,
            employeeNumber: record.technicianProfile.employee.employeeNumber,
            displayName: record.technicianProfile.employee.displayName,
            phone: record.technicianProfile.employee.phone,
            status: record.technicianProfile.employee.status,
        },
        workType: record.workType,
        workReferenceId: record.workReferenceId,
        status: record.status,
        startsAt: record.startsAt,
        endsAt: record.endsAt,
        notes: record.notes,
        completedAt: record.completedAt,
        cancelledAt: record.cancelledAt,
        cancellationReason: record.cancellationReason,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}
