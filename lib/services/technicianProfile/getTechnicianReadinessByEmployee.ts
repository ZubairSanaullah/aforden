import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type {
    TechnicianReadiness,
    TechnicianReadinessBlocker,
} from "./technicianReadiness.types";

/**
 * Evaluates the derived operational readiness of a technician by employeeId.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookups are strictly scoped by `workspaceId === workspaceId`.
 *   - Returns `TechnicianReadiness | null` if the employee is not found or belongs to another workspace.
 *   - If employee exists but has no TechnicianProfile, flags `hasTechnicianProfile: false`
 *     and includes `TECHNICIAN_PROFILE_MISSING` in blockers.
 *   - Zero mutation side effects.
 */
export async function getTechnicianReadinessByEmployee(
    workspaceId: string,
    employeeId: string,
): Promise<TechnicianReadiness | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Lookup by Employee ID ---
    const employee = await prisma.employee.findFirst({
        where: {
            id: employeeId,
            workspaceId,
        },
        select: {
            id: true,
            status: true,
            technicianProfile: {
                select: {
                    id: true,
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
            },
        },
    });

    if (!employee) {
        return null;
    }

    // --- Readiness Rule Evaluations ---
    const employeeStatus = employee.status;
    const profile = employee.technicianProfile;
    const hasTechnicianProfile = Boolean(profile);
    const hasActiveSkills = Boolean(
        profile?.technicianSkills.some((ts) => ts.skill.status === "ACTIVE"),
    );
    const hasActiveServiceAreas = Boolean(
        profile?.technicianServiceAreas.some(
            (tsa) => tsa.serviceArea.status === "ACTIVE",
        ),
    );
    const hasActiveAvailability = Boolean(
        profile?.technicianAvailabilities.some((ta) => ta.status === "ACTIVE"),
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
        technicianProfileId: profile ? profile.id : null,
        employeeId: employee.id,
        isReady,
        employeeStatus,
        hasTechnicianProfile,
        hasActiveSkills,
        hasActiveServiceAreas,
        hasActiveAvailability,
        blockers,
    };
}
