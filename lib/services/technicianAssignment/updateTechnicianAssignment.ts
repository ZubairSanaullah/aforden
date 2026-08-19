import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    updateTechnicianAssignmentSchema,
    type UpdateTechnicianAssignmentInput,
} from "@/lib/validations/technicianAssignment";
import { assertTechnicianAssignmentEligibility } from "./assignmentEligibilityUtils";
import {
    TechnicianAssignmentNotFoundError,
    TechnicianAssignmentOverlapError,
    InvalidAssignmentTimeError,
    AssignmentImmutableError,
} from "./technicianAssignmentErrors";
import type { TechnicianAssignment } from "./technicianAssignment.types";

/**
 * Updates a technician assignment (time interval, notes) with strict terminal immutability guards,
 * fresh eligibility revalidation, and temporal overlap protection.
 *
 * Operational & Invariant guarantees:
 *   - Only ASSIGNED status assignments can be modified.
 *   - COMPLETED and CANCELLED assignments are strictly immutable (rejects with AssignmentImmutableError).
 *   - Interval modifications trigger dynamic eligibility revalidation against current employee, schedule, exceptions, skills, and areas.
 *   - Temporal overlap with other active assignments is rejected.
 */
export async function updateTechnicianAssignment(
    workspaceId: string,
    assignmentId: string,
    input: UpdateTechnicianAssignmentInput,
): Promise<TechnicianAssignment> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Assignment / Scheduler Permission ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_UPDATE,
    ]);

    // --- Validate Input Schema ---
    const data = updateTechnicianAssignmentSchema.parse(input);

    // --- Tenant-Scoped Lookup of Existing Assignment ---
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
            status: true,
            startsAt: true,
            endsAt: true,
            notes: true,
            workType: true,
            workReferenceId: true,
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

    // --- Terminal Immutability Guard ---
    if (existing.status !== "ASSIGNED") {
        throw new AssignmentImmutableError(existing.id, existing.status);
    }

    const newStartsAt = data.startsAt ?? existing.startsAt;
    const newEndsAt = data.endsAt ?? existing.endsAt;

    if (newStartsAt.getTime() >= newEndsAt.getTime()) {
        throw new InvalidAssignmentTimeError();
    }

    const intervalChanged =
        newStartsAt.getTime() !== existing.startsAt.getTime() ||
        newEndsAt.getTime() !== existing.endsAt.getTime();

    // If time interval changed, freshly re-validate eligibility & overlap
    if (intervalChanged) {
        await assertTechnicianAssignmentEligibility({
            workspaceId,
            technicianProfileId: existing.technicianProfileId,
            timezone: authorization.workspace.timezone,
            startsAt: newStartsAt,
            endsAt: newEndsAt,
            serviceAreaId: data.serviceAreaId,
            requiredSkillIds: data.requiredSkillIds,
        });

        // Overlap guard with other active assignments
        const overlapping = await prisma.technicianAssignment.findFirst({
            where: {
                id: { not: existing.id },
                technicianProfileId: existing.technicianProfileId,
                status: "ASSIGNED",
                startsAt: {
                    lt: newEndsAt,
                },
                endsAt: {
                    gt: newStartsAt,
                },
            },
        });

        if (overlapping) {
            throw new TechnicianAssignmentOverlapError();
        }
    }

    const updated = await prisma.technicianAssignment.update({
        where: {
            id: existing.id,
        },
        data: {
            startsAt: newStartsAt,
            endsAt: newEndsAt,
            notes: data.notes !== undefined ? data.notes : existing.notes,
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
