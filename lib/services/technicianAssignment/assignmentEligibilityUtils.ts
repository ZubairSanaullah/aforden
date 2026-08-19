import { prisma } from "@/lib/prisma";
import { evaluateIntervalAvailability } from "@/lib/services/technicianProfile/availabilityIntervalUtils";
import { TechnicianNotEligibleForAssignmentError } from "./technicianAssignmentErrors";

export interface AssignmentEligibilityParams {
    workspaceId: string;
    technicianProfileId: string;
    timezone: string;
    startsAt: Date;
    endsAt: Date;
    serviceAreaId?: string;
    requiredSkillIds?: string[];
}

/**
 * Re-evaluates technician work eligibility at assignment time.
 * Throws TechnicianNotEligibleForAssignmentError if ineligible.
 */
export async function assertTechnicianAssignmentEligibility(
    params: AssignmentEligibilityParams,
): Promise<void> {
    const {
        workspaceId,
        technicianProfileId,
        timezone,
        startsAt,
        endsAt,
        serviceAreaId,
        requiredSkillIds = [],
    } = params;

    // Fetch tenant-scoped technician profile with relations
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
        throw new TechnicianNotEligibleForAssignmentError(
            "Technician profile not found in workspace.",
            ["TECHNICIAN_PROFILE_MISSING"],
        );
    }

    const blockers: string[] = [];

    // 1. Service area check (if specified)
    let targetServiceArea: { id: string; name: string; status: string } | null =
        null;
    if (serviceAreaId) {
        targetServiceArea = await prisma.serviceArea.findFirst({
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

        if (!targetServiceArea || targetServiceArea.status !== "ACTIVE") {
            blockers.push("SERVICE_AREA_INACTIVE");
        }
    }

    // 2. Employee status check
    if (profile.employee.status !== "ACTIVE") {
        blockers.push("EMPLOYEE_NOT_ACTIVE");
    }

    // 3. Required skills check
    if (requiredSkillIds.length > 0) {
        const requiredSkillsInDb = await prisma.skill.findMany({
            where: {
                id: { in: requiredSkillIds },
                workspaceId,
            },
            select: {
                id: true,
                name: true,
                status: true,
            },
        });

        const missingSkills: string[] = [];
        for (const reqSkillId of requiredSkillIds) {
            const dbSkill = requiredSkillsInDb.find((s) => s.id === reqSkillId);
            const techSkill = profile.technicianSkills.find(
                (ts: { skillId: string; skill: { status: string } }) =>
                    ts.skillId === reqSkillId && ts.skill.status === "ACTIVE",
            );

            if (!techSkill || !dbSkill || dbSkill.status !== "ACTIVE") {
                missingSkills.push(reqSkillId);
            }
        }

        if (missingSkills.length > 0) {
            blockers.push("MISSING_REQUIRED_SKILLS");
        }
    }

    // 4. Service area assignment check
    if (targetServiceArea && targetServiceArea.status === "ACTIVE") {
        const hasArea = profile.technicianServiceAreas.some(
            (tsa: { serviceAreaId: string; serviceArea: { status: string } }) =>
                tsa.serviceAreaId === targetServiceArea!.id &&
                tsa.serviceArea.status === "ACTIVE",
        );
        if (!hasArea) {
            blockers.push("SERVICE_AREA_NOT_ASSIGNED");
        }
    }

    // 5. Point-in-time availability evaluation
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
        timezone,
        activeRecurring as any,
        profile.technicianAvailabilityExceptions as any,
    );

    const availBlockers: string[] = [];
    if (profile.employee.status !== "ACTIVE") {
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

    if (availBlockers.length > 0) {
        blockers.push("TECHNICIAN_NOT_AVAILABLE");
    }

    if (blockers.length > 0) {
        throw new TechnicianNotEligibleForAssignmentError(
            "Technician is not eligible for this assignment.",
            blockers,
        );
    }
}
