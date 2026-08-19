import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    TechnicianAssignmentNotFoundError,
    AssignmentInvalidStatusTransitionError,
} from "./technicianAssignmentErrors";
import type { TechnicianAssignment } from "./technicianAssignment.types";

/**
 * Dedicated lifecycle service to complete an active technician assignment (ASSIGNED -> COMPLETED).
 *
 * Operational & Invariant guarantees:
 *   - Only ASSIGNED assignments can be transitioned to COMPLETED.
 *   - Transitioning from CANCELLED or re-completing COMPLETED throws AssignmentInvalidStatusTransitionError.
 *   - Populates completedAt timestamp.
 *   - Does NOT revalidate technician eligibility (completion marks operational conclusion of previously scheduled work).
 *   - Strictly tenant scoped.
 *   - Zero credential leakage.
 */
export async function completeTechnicianAssignment(
    workspaceId: string,
    assignmentId: string,
): Promise<TechnicianAssignment> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Assignment Completion Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_UPDATE,
    ]);

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
            "COMPLETED",
        );
    }

    const completedAt = new Date();

    const updated = await prisma.technicianAssignment.update({
        where: {
            id: existing.id,
        },
        data: {
            status: "COMPLETED",
            completedAt,
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
