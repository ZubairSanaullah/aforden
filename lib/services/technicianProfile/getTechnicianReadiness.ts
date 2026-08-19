import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type {
    TechnicianReadiness,
    TechnicianReadinessBlocker,
} from "./technicianReadiness.types";

/**
 * Evaluates the derived operational readiness of a technician by technicianProfileId.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookups are strictly scoped by `employee.workspaceId === workspaceId`.
 *   - Returns `TechnicianReadiness | null` if not found or belongs to another workspace.
 *   - Zero mutation side effects.
 *   - Excludes sensitive authentication data (passwords, tokens, sessions, accounts).
 *   - Evaluates general readiness (active employee status, profile existence,
 *     at least 1 active skill, at least 1 active service area, at least 1 active availability window).
 *   - Blockers are always returned in deterministic order.
 */
export async function getTechnicianReadiness(
    workspaceId: string,
    technicianProfileId: string,
): Promise<TechnicianReadiness | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup ---
    const profile = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
        select: {
            id: true,
            employeeId: true,
            employee: {
                select: {
                    status: true,
                },
            },
            technicianSkills: {
                select: {
                    skill: {
                        select: {
                            status: true,
                        },
                    },
                },
            },
            technicianServiceAreas: {
                select: {
                    serviceArea: {
                        select: {
                            status: true,
                        },
                    },
                },
            },
            technicianAvailabilities: {
                select: {
                    status: true,
                },
            },
        },
    });

    if (!profile) {
        return null;
    }

    // --- Readiness Rule Evaluations ---
    const employeeStatus = profile.employee.status;
    const hasTechnicianProfile = true;
    const hasActiveSkills = profile.technicianSkills.some(
        (ts) => ts.skill.status === "ACTIVE",
    );
    const hasActiveServiceAreas = profile.technicianServiceAreas.some(
        (tsa) => tsa.serviceArea.status === "ACTIVE",
    );
    const hasActiveAvailability = profile.technicianAvailabilities.some(
        (ta) => ta.status === "ACTIVE",
    );

    const isReady =
        employeeStatus === "ACTIVE" &&
        hasTechnicianProfile &&
        hasActiveSkills &&
        hasActiveServiceAreas &&
        hasActiveAvailability;

    // --- Construct Deterministic Blockers List ---
    const blockers: TechnicianReadinessBlocker[] = [];

    if (employeeStatus !== "ACTIVE") {
        blockers.push("EMPLOYEE_NOT_ACTIVE");
    }
    if (!hasTechnicianProfile) {
        blockers.push("TECHNICIAN_PROFILE_MISSING");
    }
    if (!hasActiveSkills) {
        blockers.push("NO_ACTIVE_SKILLS");
    }
    if (!hasActiveServiceAreas) {
        blockers.push("NO_ACTIVE_SERVICE_AREAS");
    }
    if (!hasActiveAvailability) {
        blockers.push("NO_ACTIVE_AVAILABILITY");
    }

    return {
        technicianProfileId: profile.id,
        employeeId: profile.employeeId,
        isReady,
        employeeStatus,
        hasTechnicianProfile,
        hasActiveSkills,
        hasActiveServiceAreas,
        hasActiveAvailability,
        blockers,
    };
}
