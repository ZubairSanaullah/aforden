import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    cancelTechnicianAssignmentSchema,
    type CancelTechnicianAssignmentInput,
} from "@/lib/validations/technicianAssignment";
import {
    TechnicianAssignmentNotFoundError,
    AssignmentInvalidStatusTransitionError,
} from "./technicianAssignmentErrors";
import type { TechnicianAssignment } from "./technicianAssignment.types";

/**
 * Dedicated lifecycle service to cancel an active technician assignment (ASSIGNED -> CANCELLED).
 *
 * Operational & Invariant guarantees:
 *   - Only ASSIGNED assignments can be transitioned to CANCELLED.
 *   - Transitioning from COMPLETED or re-cancelling CANCELLED throws AssignmentInvalidStatusTransitionError.
 *   - Populates cancelledAt timestamp and optional cancellationReason.
 *   - Preserves historical assignment records without physical row deletion.
 *   - Strictly tenant scoped.
 *   - Zero credential leakage.
 */
export async function cancelTechnicianAssignment(
    workspaceId: string,
    assignmentId: string,
    input?: CancelTechnicianAssignmentInput,
): Promise<TechnicianAssignment> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Cancellation Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_UPDATE,
    ]);

    // --- Validate Input Schema ---
    const data = cancelTechnicianAssignmentSchema.parse(input ?? {});

    // --- Tenant-Scoped Lookup of Assignment ---
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
            "CANCELLED",
        );
    }

    const cancelledAt = new Date();

    const updated = await prisma.technicianAssignment.update({
        where: {
            id: existing.id,
        },
        data: {
            status: "CANCELLED",
            cancelledAt,
            cancellationReason: data.cancellationReason ?? null,
        },
    });

    return {
        id: updated.id,
        technicianProfileId: updated.technicianProfileId,
        employeeId: existing.technicianProfile.employeeId,
        workType: updated.workType,
        workReferenceId: updated.workReferenceId,
        status: updated.status,
        startsAt: updated.startsAt,
        endsAt: updated.endsAt,
        notes: updated.notes,
        completedAt: updated.completedAt,
        cancelledAt: updated.cancelledAt,
        cancellationReason: updated.cancellationReason,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
    };
}
