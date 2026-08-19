import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { getEligibleTechniciansQuerySchema } from "@/lib/validations/technicianWorkEligibility";
import { evaluateIntervalAvailability } from "./availabilityIntervalUtils";
import type {
    EligibleTechniciansResult,
    TechnicianWorkEligibility,
    TechnicianWorkEligibilityBlocker,
    TechnicianMatchedSkill,
    TechnicianMissingSkill,
    TechnicianMatchedServiceArea,
    TechnicianAvailabilityCheckSummary,
} from "./technicianWorkEligibility.types";

/**
 * Searches and retrieves all technicians within a workspace eligible for requested field work.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookups and evaluations are strictly scoped by `employee.workspaceId === workspaceId`.
 *   - Returns ONLY eligible technicians (`isEligible === true`).
 *   - Deterministically sorted by `displayName ASC`, then `employeeId ASC`.
 *   - Supports standard Aforden pagination (`page`, `pageSize`).
 *   - Zero mutation side effects.
 */
export async function getEligibleTechnicians(
    workspaceId: string,
    input: unknown,
): Promise<EligibleTechniciansResult> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Validate Input Query ---
    const validated = getEligibleTechniciansQuerySchema.parse(input);
    const { requiredSkillIds, serviceAreaId, startsAt, endsAt } = validated;
    const page = validated.page ?? 1;
    const pageSize = validated.pageSize ?? 20;

    // --- Resolve Requested Service Area in Workspace ---
    const targetServiceArea = await prisma.serviceArea.findFirst({
        where: {
            id: serviceAreaId,
            workspaceId,
        },
        select: {
            id: true,
            name: true,
            status: true,
        },
    });

    // If requested service area is missing or not active, no technicians can match
    if (!targetServiceArea || targetServiceArea.status !== "ACTIVE") {
        return {
            items: [],
            pagination: {
                page,
                pageSize,
                total: 0,
                totalPages: 0,
                hasNextPage: false,
                hasPreviousPage: false,
            },
        };
    }

    // --- Resolve Required Skills in Workspace ---
    const requiredSkillsInDb =
        requiredSkillIds.length > 0
            ? await prisma.skill.findMany({
                  where: {
                      id: { in: requiredSkillIds },
                      workspaceId,
                  },
                  select: {
                      id: true,
                      name: true,
                      status: true,
                  },
              })
            : [];

    // If any requested skill does not exist or is inactive, no technician can satisfy all requirements
    const allRequiredSkillsActive =
        requiredSkillIds.length === 0 ||
        (requiredSkillsInDb.length === requiredSkillIds.length &&
            requiredSkillsInDb.every((s) => s.status === "ACTIVE"));

    // --- Retrieve Tenant-Scoped Technician Profiles ---
    const profiles = await prisma.technicianProfile.findMany({
        where: {
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

    const eligibleTechnicians: TechnicianWorkEligibility[] = [];

    for (const profile of profiles) {
        const employeeStatus = profile.employee.status;
        const displayName = profile.employee.displayName;
        const hasTechnicianProfile = true;

        // Service area match check
        const hasRequiredServiceArea = profile.technicianServiceAreas.some(
            (tsa: { serviceAreaId: string; serviceArea: { status: string } }) =>
                tsa.serviceAreaId === targetServiceArea.id &&
                tsa.serviceArea.status === "ACTIVE",
        );

        const matchedServiceAreas: TechnicianMatchedServiceArea[] =
            hasRequiredServiceArea
                ? [
                      {
                          id: targetServiceArea.id,
                          name: targetServiceArea.name,
                          status: targetServiceArea.status,
                      },
                  ]
                : [];

        // Required skills check
        const matchedSkills: TechnicianMatchedSkill[] = [];
        const missingSkills: TechnicianMissingSkill[] = [];

        if (allRequiredSkillsActive) {
            for (const reqSkillId of requiredSkillIds) {
                const dbSkill = requiredSkillsInDb.find(
                    (s) => s.id === reqSkillId,
                );
                const techSkill = profile.technicianSkills.find(
                    (ts: { skillId: string; skill: { status: string } }) =>
                        ts.skillId === reqSkillId &&
                        ts.skill.status === "ACTIVE",
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
        } else {
            // Some required skill is not active in DB
            for (const reqSkillId of requiredSkillIds) {
                const dbSkill = requiredSkillsInDb.find(
                    (s) => s.id === reqSkillId,
                );
                missingSkills.push({
                    skillId: reqSkillId,
                    name: dbSkill ? dbSkill.name : "Unknown Skill",
                });
            }
        }

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

        // Point-in-time availability evaluation
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
            startsAt,
            endsAt,
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

        const isAvailable = availBlockers.length === 0;
        const availabilityCheck: TechnicianAvailabilityCheckSummary = {
            isAvailable,
            matchingAvailabilityCount: evalResult.matchingAvailability.length,
            blockingExceptionCount: evalResult.blockingExceptions.length,
            blockers: availBlockers,
        };

        // Compile Blockers
        const blockers: TechnicianWorkEligibilityBlocker[] = [];
        if (employeeStatus !== "ACTIVE") {
            blockers.push("EMPLOYEE_NOT_ACTIVE");
        }
        if (!hasTechnicianProfile) {
            blockers.push("TECHNICIAN_PROFILE_MISSING");
        }
        if (!hasRequiredSkills) {
            blockers.push("MISSING_REQUIRED_SKILLS");
        }
        if (!hasRequiredServiceArea) {
            blockers.push("SERVICE_AREA_NOT_ASSIGNED");
        }
        if (!isAvailable) {
            blockers.push("TECHNICIAN_NOT_AVAILABLE");
        }

        const isEligible = blockers.length === 0;

        if (isEligible) {
            eligibleTechnicians.push({
                technicianProfileId: profile.id,
                employeeId: profile.employeeId,
                displayName,
                isEligible: true,
                employeeStatus,
                hasTechnicianProfile,
                hasRequiredSkills: true,
                hasRequiredServiceArea: true,
                isAvailable: true,
                matchedSkills,
                missingSkills,
                matchedServiceAreas,
                availabilityCheck,
                blockers: [],
            });
        }
    }

    // --- Deterministic Sorting (displayName ASC, employeeId ASC) ---
    eligibleTechnicians.sort((a, b) => {
        const nameCmp = (a.displayName ?? "").localeCompare(b.displayName ?? "");
        if (nameCmp !== 0) return nameCmp;
        return a.employeeId.localeCompare(b.employeeId);
    });

    // --- Pagination Calculation ---
    const total = eligibleTechnicians.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const startIndex = (page - 1) * pageSize;
    const items = eligibleTechnicians.slice(startIndex, startIndex + pageSize);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1 && totalPages > 0;

    return {
        items,
        pagination: {
            page,
            pageSize,
            total,
            totalPages,
            hasNextPage,
            hasPreviousPage,
        },
    };
}
