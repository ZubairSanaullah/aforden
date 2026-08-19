import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import type {
    AssignmentWorkType,
    TechnicianAssignment,
} from "./technicianAssignment.types";

/**
 * Retrieves all technician assignments for a specific work item in the workspace.
 * Deterministically sorted by `startsAt ASC`, `endsAt ASC`, `id ASC`.
 */
export async function getTechnicianAssignmentsByWork(
    workspaceId: string,
    params: {
        workType: AssignmentWorkType;
        workReferenceId: string;
    },
): Promise<TechnicianAssignment[]> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce View Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Tenant-Scoped Query ---
    const records = await prisma.technicianAssignment.findMany({
        where: {
            workType: params.workType,
            workReferenceId: params.workReferenceId,
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
            technicianProfile: {
                select: {
                    employeeId: true,
                },
            },
        },
    });

    return records.map((r) => ({
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
}
