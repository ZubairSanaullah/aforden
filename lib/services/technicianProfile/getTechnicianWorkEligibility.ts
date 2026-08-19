import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { technicianWorkEligibilityInputSchema } from "@/lib/validations/technicianWorkEligibility";
import { evaluateIntervalAvailability } from "./availabilityIntervalUtils";
import type {
    TechnicianWorkEligibility,
    TechnicianWorkEligibilityBlocker,
    TechnicianMatchedSkill,
    TechnicianMissingSkill,
    TechnicianMatchedServiceArea,
    TechnicianAvailabilityCheckSummary,
} from "./technicianWorkEligibility.types";

/**
 * Evaluates the derived work eligibility of a single technician by technicianProfileId.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookups are strictly scoped by `employee.workspaceId === workspaceId`.
 *   - ServiceArea and Skills are verified against `workspaceId`.
 *   - Returns `TechnicianWorkEligibility | null` if not found or belongs to another workspace.
 *   - Zero mutation side effects.
 *   - Excludes sensitive authentication data (passwords, tokens, sessions, accounts).
 *   - Deterministic blocker ordering:
 *       1. INVALID_REQUESTED_INTERVAL
 *       2. SERVICE_AREA_INACTIVE
 *       3. EMPLOYEE_NOT_ACTIVE
 *       4. TECHNICIAN_PROFILE_MISSING
 *       5. MISSING_REQUIRED_SKILLS
 *       6. SERVICE_AREA_NOT_ASSIGNED
 *       7. TECHNICIAN_NOT_AVAILABLE
 */
export async function getTechnicianWorkEligibility(
    workspaceId: string,
    technicianProfileId: string,
    input: unknown,
): Promise<TechnicianWorkEligibility | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Validate Input Interval & Fields ---
    let parsedInput: {
        requiredSkillIds: string[];
        serviceAreaId: string;
        startsAt: Date;
        endsAt: Date;
    } | null = null;
    let isInvalidInterval = false;

    try {
        parsedInput = technicianWorkEligibilityInputSchema.parse(input);
    } catch {
        isInvalidInterval = true;
        if (typeof input === "object" && input !== null) {
            const raw = input as any;
            parsedInput = {
                requiredSkillIds: Array.isArray(raw.requiredSkillIds)
                    ? raw.requiredSkillIds
                    : [],
                serviceAreaId:
                    typeof raw.serviceAreaId === "string"
                        ? raw.serviceAreaId
                        : "",
                startsAt: new Date(raw.startsAt),
                endsAt: new Date(raw.endsAt),
            };
        }
        if (!parsedInput) {
            parsedInput = {
                requiredSkillIds: [],
                serviceAreaId: "",
                startsAt: new Date(0),
                endsAt: new Date(0),
            };
        }
    }

    // --- Resolve Requested Service Area in Workspace ---
    const targetServiceArea = parsedInput.serviceAreaId
        ? await prisma.serviceArea.findFirst({
              where: {
                  id: parsedInput.serviceAreaId,
                  workspaceId,
              },
              select: {
                  id: true,
                  name: true,
                  status: true,
              },
          })
        : null;

    // --- Resolve Required Skills in Workspace ---
    const requiredSkillsInDb =
        parsedInput.requiredSkillIds.length > 0
            ? await prisma.skill.findMany({
                  where: {
                      id: { in: parsedInput.requiredSkillIds },
                      workspaceId,
                  },
                  select: {
                      id: true,
                      name: true,
                      status: true,
                  },
              })
            : [];

    // --- Tenant-Scoped Lookup of Technician Profile ---
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
                    id: true,
                    status: true,
                    displayName: true,
                },
            },
            technicianSkills: {
                select: {
                    skillId: true,
                    proficiency: true,
                    skill: {
                        select: {
                            id: true,
                            name: true,
                            status: true,
                        },
                    },
                },
            },
            technicianServiceAreas: {
                select: {
                    serviceAreaId: true,
                    serviceArea: {
                        select: {
                            id: true,
                            name: true,
                            status: true,
                        },
                    },
                },
            },
            technicianAvailabilities: {
                select: {
                    id: true,
                    dayOfWeek: true,
                    startTime: true,
                    endTime: true,
                    status: true,
                },
            },
            technicianAvailabilityExceptions: {
                select: {
                    id: true,
                    type: true,
                    title: true,
                    startsAt: true,
                    endsAt: true,
                    isAllDay: true,
                    status: true,
                },
            },
        },
    });

    if (!profile) {
        return null;
    }

    // --- Employee & Profile Prerequisites ---
    const employeeStatus = profile.employee.status;
    const displayName = profile.employee.displayName;
    const hasTechnicianProfile = true;

    // --- Service Area Rule Evaluation ---
    const isServiceAreaInactive = Boolean(
        targetServiceArea && targetServiceArea.status !== "ACTIVE",
    );
    const hasRequiredServiceArea = Boolean(
        targetServiceArea &&
            targetServiceArea.status === "ACTIVE" &&
            profile.technicianServiceAreas.some(
                (tsa: { serviceAreaId: string; serviceArea: { status: string } }) =>
                    tsa.serviceAreaId === targetServiceArea.id &&
                    tsa.serviceArea.status === "ACTIVE",
            ),
    );

    const matchedServiceAreas: TechnicianMatchedServiceArea[] =
        targetServiceArea && hasRequiredServiceArea
            ? [
                  {
                      id: targetServiceArea.id,
                      name: targetServiceArea.name,
                      status: targetServiceArea.status,
                  },
              ]
            : [];

    // --- Required Skills Rule Evaluation ---
    const matchedSkills: TechnicianMatchedSkill[] = [];
    const missingSkills: TechnicianMissingSkill[] = [];

    for (const reqSkillId of parsedInput.requiredSkillIds) {
        const dbSkill = requiredSkillsInDb.find((s) => s.id === reqSkillId);
        const techSkill = profile.technicianSkills.find(
            (ts: { skillId: string; skill: { status: string } }) =>
                ts.skillId === reqSkillId && ts.skill.status === "ACTIVE",
        );

        if (techSkill && dbSkill && dbSkill.status === "ACTIVE") {
            matchedSkills.push({
                skillId: dbSkill.id,
                name: dbSkill.name,
                proficiency: techSkill.proficiency,
            });
        } else {
            missingSkills.push({
                skillId: reqSkillId,
                name: dbSkill ? dbSkill.name : "Unknown Skill",
            });
        }
    }

    // Sort skills deterministically (name ASC, skillId ASC)
    const sortSkills = <T extends { name: string; skillId: string }>(
        items: T[],
    ): T[] => {
        return items.sort((a, b) => {
            const nameCmp = a.name.localeCompare(b.name);
            if (nameCmp !== 0) return nameCmp;
            return a.skillId.localeCompare(b.skillId);
        });
    };

    sortSkills(matchedSkills);
    sortSkills(missingSkills);

    const hasRequiredSkills = missingSkills.length === 0;

    // --- Point-in-Time Availability Evaluation ---
    let isAvailable = false;
    let availabilityCheck: TechnicianAvailabilityCheckSummary = {
        isAvailable: false,
        matchingAvailabilityCount: 0,
        blockingExceptionCount: 0,
        blockers: [],
    };

    if (!isInvalidInterval && parsedInput) {
        const activeRecurring = profile.technicianAvailabilities.filter(
            (a: { status: string }) => a.status === "ACTIVE",
        );
        const activeSkillsExist = profile.technicianSkills.some(
            (ts: { skill: { status: string } }) => ts.skill.status === "ACTIVE",
        );
        const activeServiceAreasExist = profile.technicianServiceAreas.some(
            (tsa: { serviceArea: { status: string } }) =>
                tsa.serviceArea.status === "ACTIVE",
        );
        const hasActiveAvailability = activeRecurring.length > 0;

        const evalResult = evaluateIntervalAvailability(
            parsedInput.startsAt,
            parsedInput.endsAt,
            authorization.workspace.timezone,
            activeRecurring as any,
            profile.technicianAvailabilityExceptions as any,
        );

        const availBlockers: string[] = [];
        if (employeeStatus !== "ACTIVE") {
            availBlockers.push("EMPLOYEE_NOT_ACTIVE");
        }
        if (!activeSkillsExist) {
            availBlockers.push("NO_ACTIVE_SKILLS");
        }
        if (!activeServiceAreasExist) {
            availBlockers.push("NO_ACTIVE_SERVICE_AREAS");
        }
        if (!hasActiveAvailability) {
            availBlockers.push("NO_RECURRING_AVAILABILITY");
        }
        if (!evalResult.isCoveredByRecurring) {
            availBlockers.push("OUTSIDE_RECURRING_AVAILABILITY");
        }
        if (evalResult.blockingExceptions.length > 0) {
            availBlockers.push("BLOCKED_BY_EXCEPTION");
        }

        isAvailable = availBlockers.length === 0;
        availabilityCheck = {
            isAvailable,
            matchingAvailabilityCount: evalResult.matchingAvailability.length,
            blockingExceptionCount: evalResult.blockingExceptions.length,
            blockers: availBlockers,
        };
    }

    // --- Construct Deterministic Blockers List ---
    const blockers: TechnicianWorkEligibilityBlocker[] = [];

    if (isInvalidInterval) {
        blockers.push("INVALID_REQUESTED_INTERVAL");
    }
    if (isServiceAreaInactive) {
        blockers.push("SERVICE_AREA_INACTIVE");
    }
    if (employeeStatus !== "ACTIVE") {
        blockers.push("EMPLOYEE_NOT_ACTIVE");
    }
    if (!hasTechnicianProfile) {
        blockers.push("TECHNICIAN_PROFILE_MISSING");
    }
    if (!hasRequiredSkills) {
        blockers.push("MISSING_REQUIRED_SKILLS");
    }
    if (!isServiceAreaInactive && !hasRequiredServiceArea) {
        blockers.push("SERVICE_AREA_NOT_ASSIGNED");
    }
    if (!isAvailable) {
        blockers.push("TECHNICIAN_NOT_AVAILABLE");
    }

    const isEligible = blockers.length === 0;

    return {
        technicianProfileId: profile.id,
        employeeId: profile.employeeId,
        displayName,
        isEligible,
        employeeStatus,
        hasTechnicianProfile,
        hasRequiredSkills,
        hasRequiredServiceArea,
        isAvailable,
        matchedSkills,
        missingSkills,
        matchedServiceAreas,
        availabilityCheck,
        blockers,
    };
}
