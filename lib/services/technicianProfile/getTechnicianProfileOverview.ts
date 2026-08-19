import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { AvailabilityDay } from "@/generated/prisma/client";
import type { TechnicianProfileOverview } from "./technicianProfileOverview.types";

const DAY_ORDER: Record<AvailabilityDay, number> = {
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
    SUNDAY: 7,
};

/**
 * Retrieves the complete aggregated read model for a TechnicianProfile by technicianProfileId.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookup is strictly scoped by `employee.workspaceId === workspaceId`.
 *   - Returns `TechnicianProfileOverview | null` if not found or belongs to another workspace.
 *   - Zero mutation side effects.
 *   - Excludes sensitive authentication data (passwords, tokens, sessions, accounts).
 *   - Deterministically orders skills (name ASC), service areas (name ASC),
 *     availability (Monday -> Sunday, startTime ASC), and exceptions (startsAt ASC, endsAt ASC).
 */
export async function getTechnicianProfileOverview(
    workspaceId: string,
    technicianProfileId: string,
): Promise<TechnicianProfileOverview | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Tenant-Scoped Aggregate Lookup ---
    const profile = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
        select: {
            id: true,
            licenseNumber: true,
            yearsExperience: true,
            emergencyContact: true,
            notes: true,
            employee: {
                select: {
                    id: true,
                    employeeNumber: true,
                    displayName: true,
                    phone: true,
                    hireDate: true,
                    status: true,
                    notes: true,
                    department: {
                        select: {
                            id: true,
                            name: true,
                            description: true,
                            status: true,
                        },
                    },
                    jobTitle: {
                        select: {
                            id: true,
                            name: true,
                            description: true,
                            status: true,
                        },
                    },
                },
            },
            technicianSkills: {
                select: {
                    id: true,
                    proficiency: true,
                    yearsExperience: true,
                    notes: true,
                    skill: {
                        select: {
                            id: true,
                            name: true,
                            description: true,
                            status: true,
                        },
                    },
                },
                orderBy: {
                    skill: {
                        name: "asc",
                    },
                },
            },
            technicianServiceAreas: {
                select: {
                    id: true,
                    notes: true,
                    serviceArea: {
                        select: {
                            id: true,
                            name: true,
                            description: true,
                            status: true,
                        },
                    },
                },
                orderBy: {
                    serviceArea: {
                        name: "asc",
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
                    notes: true,
                },
            },
            technicianAvailabilityExceptions: {
                select: {
                    id: true,
                    type: true,
                    status: true,
                    title: true,
                    startsAt: true,
                    endsAt: true,
                    isAllDay: true,
                    notes: true,
                },
                orderBy: [{ startsAt: "asc" }, { endsAt: "asc" }],
            },
        },
    });

    if (!profile) {
        return null;
    }

    // --- Deterministic Sorting for Recurring Availability ---
    const sortedAvailability = [...profile.technicianAvailabilities].sort(
        (a, b) => {
            const dayDiff = DAY_ORDER[a.dayOfWeek] - DAY_ORDER[b.dayOfWeek];
            if (dayDiff !== 0) return dayDiff;
            return a.startTime.localeCompare(b.startTime);
        },
    );

    // --- Map to Read Model ---
    const overview: TechnicianProfileOverview = {
        employee: {
            id: profile.employee.id,
            employeeNumber: profile.employee.employeeNumber,
            displayName: profile.employee.displayName,
            phone: profile.employee.phone,
            hireDate: profile.employee.hireDate,
            status: profile.employee.status,
            notes: profile.employee.notes,
        },
        department: profile.employee.department ?? null,
        jobTitle: profile.employee.jobTitle ?? null,
        technicianProfile: {
            id: profile.id,
            licenseNumber: profile.licenseNumber,
            yearsExperience: profile.yearsExperience,
            emergencyContact: profile.emergencyContact,
            notes: profile.notes,
        },
        skills: profile.technicianSkills ?? [],
        serviceAreas: profile.technicianServiceAreas ?? [],
        availability: sortedAvailability,
        availabilityExceptions: profile.technicianAvailabilityExceptions ?? [],
    };

    return overview;
}
