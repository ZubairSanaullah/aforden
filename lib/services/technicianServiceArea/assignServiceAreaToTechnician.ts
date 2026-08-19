import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createTechnicianServiceAreaSchema } from "@/lib/validations/technicianServiceArea";
import {
    TechnicianServiceAreaAlreadyExistsError,
    InvalidTechnicianProfileError,
    InvalidServiceAreaAssignmentError,
} from "./technicianServiceAreaErrors";
import { InactiveServiceAreaAssignmentError } from "@/lib/services/serviceArea/serviceAreaErrors";
import type { TechnicianServiceArea, ServiceArea } from "@/generated/prisma/client";

export type TechnicianServiceAreaWithServiceArea = TechnicianServiceArea & {
    serviceArea: ServiceArea;
};

/**
 * Assigns a ServiceArea to a TechnicianProfile within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`createTechnicianServiceAreaSchema`).
 *   - TechnicianProfile must exist and belong to the workspace (`employee.workspaceId === workspaceId`).
 *   - ServiceArea must exist and belong to the same workspace (`serviceArea.workspaceId === workspaceId`).
 *   - ServiceArea must be ACTIVE; assignments to INACTIVE service areas are rejected (`InactiveServiceAreaAssignmentError`).
 *   - Enforces unique assignment per (technicianProfileId, serviceAreaId).
 */
export async function assignServiceAreaToTechnician(
    workspaceId: string,
    technicianProfileId: string,
    serviceAreaId: string,
    input?: unknown,
): Promise<TechnicianServiceAreaWithServiceArea> {
    // --- Validate Input ---
    const data = createTechnicianServiceAreaSchema.parse(input ?? {});

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify TechnicianProfile Exists in Workspace ---
    const profile = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
    });

    if (!profile) {
        throw new InvalidTechnicianProfileError();
    }

    // --- Verify ServiceArea Exists in Workspace and is Active ---
    const serviceArea = await prisma.serviceArea.findFirst({
        where: {
            id: serviceAreaId,
            workspaceId,
        },
    });

    if (!serviceArea) {
        throw new InvalidServiceAreaAssignmentError();
    }

    if (serviceArea.status === "INACTIVE") {
        throw new InactiveServiceAreaAssignmentError(
            "Cannot assign an inactive service area to a technician.",
        );
    }

    // --- Verify No Duplicate Assignment ---
    const existing = await prisma.technicianServiceArea.findUnique({
        where: {
            technicianProfileId_serviceAreaId: {
                technicianProfileId,
                serviceAreaId,
            },
        },
    });

    if (existing) {
        throw new TechnicianServiceAreaAlreadyExistsError();
    }

    // --- Create TechnicianServiceArea Assignment ---
    const technicianServiceArea = await prisma.technicianServiceArea.create({
        data: {
            technicianProfileId,
            serviceAreaId,
            notes: data.notes ?? null,
        },
        include: {
            serviceArea: true,
        },
    });

    return technicianServiceArea;
}
