import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    createTechnicianAssignmentSchema,
    type CreateTechnicianAssignmentInput,
} from "@/lib/validations/technicianAssignment";
import { assertTechnicianAssignmentEligibility } from "./assignmentEligibilityUtils";
import {
    InvalidTechnicianProfileError,
    TechnicianAssignmentAlreadyExistsError,
    TechnicianAssignmentOverlapError,
} from "./technicianAssignmentErrors";
import type { TechnicianAssignment } from "./technicianAssignment.types";

/**
 * Creates a new technician assignment to a work reference.
 *
 * Security & Validation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold assignment permission (OWNER, ADMIN, MANAGER, or DISPATCHER).
 *   - TechnicianProfile must belong to the workspace.
 *   - Dynamic work eligibility / point-in-time availability is freshly evaluated.
 *   - Duplicate active assignments for the same work reference are rejected.
 *   - Temporal overlaps with other active assignments are rejected ([start, end) interval model).
 *   - Clean projection (zero credentials/tokens returned).
 */
export async function createTechnicianAssignment(
    workspaceId: string,
    input: CreateTechnicianAssignmentInput,
): Promise<TechnicianAssignment> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Assignment Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Validate Input Schema ---
    const data = createTechnicianAssignmentSchema.parse(input);

    // --- Tenant-Scoped Verification of Technician Profile ---
    const profile = await prisma.technicianProfile.findFirst({
        where: {
            id: data.technicianProfileId,
            employee: {
                workspaceId,
            },
        },
        select: {
            id: true,
            employeeId: true,
        },
    });

    if (!profile) {
        throw new InvalidTechnicianProfileError();
    }

    // --- Dynamic Fresh Eligibility / Availability Revalidation ---
    await assertTechnicianAssignmentEligibility({
        workspaceId,
        technicianProfileId: profile.id,
        timezone: authorization.workspace.timezone,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        serviceAreaId: data.serviceAreaId,
        requiredSkillIds: data.requiredSkillIds,
    });

    // --- Guard Duplicate Active Assignment ---
    const existingActive = await prisma.technicianAssignment.findFirst({
        where: {
            technicianProfileId: profile.id,
            workType: data.workType,
            workReferenceId: data.workReferenceId,
            status: "ASSIGNED",
        },
    });

    if (existingActive) {
        throw new TechnicianAssignmentAlreadyExistsError();
    }

    // --- Guard Temporal Overlap ([startsAt, endsAt) interval model) ---
    const overlapping = await prisma.technicianAssignment.findFirst({
        where: {
            technicianProfileId: profile.id,
            status: "ASSIGNED",
            startsAt: {
                lt: data.endsAt,
            },
            endsAt: {
                gt: data.startsAt,
            },
        },
    });

    if (overlapping) {
        throw new TechnicianAssignmentOverlapError();
    }

    // --- Create Technician Assignment ---
    const assignment = await prisma.technicianAssignment.create({
        data: {
            technicianProfileId: profile.id,
            workType: data.workType,
            workReferenceId: data.workReferenceId,
            status: "ASSIGNED",
            startsAt: data.startsAt,
            endsAt: data.endsAt,
            notes: data.notes ?? null,
        },
    });

    return {
        id: assignment.id,
        technicianProfileId: assignment.technicianProfileId,
        employeeId: profile.employeeId,
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
