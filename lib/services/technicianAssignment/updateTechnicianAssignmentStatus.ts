import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    updateTechnicianAssignmentStatusSchema,
    type UpdateTechnicianAssignmentStatusInput,
} from "@/lib/validations/technicianAssignment";
import {
    TechnicianAssignmentNotFoundError,
    AssignmentInvalidStatusTransitionError,
} from "./technicianAssignmentErrors";
import { completeTechnicianAssignment } from "./completeTechnicianAssignment";
import { cancelTechnicianAssignment } from "./cancelTechnicianAssignment";
import type { TechnicianAssignment } from "./technicianAssignment.types";

/**
 * Updates the lifecycle status of a technician assignment with strict transition guards.
 */
export async function updateTechnicianAssignmentStatus(
    workspaceId: string,
    assignmentId: string,
    input: UpdateTechnicianAssignmentStatusInput,
): Promise<TechnicianAssignment> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Status / Assignment Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_UPDATE,
    ]);

    // --- Validate Input Schema ---
    const data = updateTechnicianAssignmentStatusSchema.parse(input);

    if (data.status === "COMPLETED") {
        return completeTechnicianAssignment(workspaceId, assignmentId);
    }

    if (data.status === "CANCELLED") {
        return cancelTechnicianAssignment(workspaceId, assignmentId, {
            cancellationReason: data.cancellationReason,
        });
    }

    // Attempting transition to ASSIGNED
    const existing = await prisma.technicianAssignment.findFirst({
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

    if (!existing) {
        throw new TechnicianAssignmentNotFoundError();
    }

    if (existing.status !== "ASSIGNED") {
        throw new AssignmentInvalidStatusTransitionError(
            existing.id,
            existing.status,
            "ASSIGNED",
        );
    }

    return {
        id: existing.id,
        technicianProfileId: existing.technicianProfileId,
        employeeId: existing.technicianProfile.employeeId,
        workType: existing.workType,
        workReferenceId: existing.workReferenceId,
        status: existing.status,
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        notes: existing.notes,
        completedAt: existing.completedAt,
        cancelledAt: existing.cancelledAt,
        cancellationReason: existing.cancellationReason,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
    };
}
