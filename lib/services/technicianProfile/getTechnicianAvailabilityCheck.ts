import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { technicianAvailabilityCheckInputSchema } from "@/lib/validations/technicianAvailabilityCheck";
import { evaluateIntervalAvailability } from "./availabilityIntervalUtils";
import type {
    TechnicianAvailabilityCheck,
    TechnicianAvailabilityBlocker,
    RecurringAvailabilityWindow,
    BlockingExceptionInfo,
} from "./technicianAvailabilityCheck.types";

/**
 * Evaluates the derived point-in-time availability and scheduling eligibility of a technician by technicianProfileId.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Lookups are strictly scoped by `employee.workspaceId === workspaceId`.
 *   - Returns `TechnicianAvailabilityCheck | null` if not found or belongs to another workspace.
 *   - Zero mutation side effects.
 *   - Excludes sensitive authentication data (passwords, tokens, sessions, accounts).
 *   - Evaluates baseline operational readiness, recurring schedule coverage in workspace timezone,
 *     and blocking active schedule exceptions.
 *   - Blockers are always returned in deterministic order.
 */
export async function getTechnicianAvailabilityCheck(
    workspaceId: string,
    technicianProfileId: string,
    input: unknown,
): Promise<TechnicianAvailabilityCheck | null> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Validate Input Interval ---
    let parsedInterval: { startsAt: Date; endsAt: Date } | null = null;
    let isInvalidInterval = false;

    try {
        parsedInterval = technicianAvailabilityCheckInputSchema.parse(input);
    } catch {
        isInvalidInterval = true;
        if (
            typeof input === "object" &&
            input !== null &&
            "startsAt" in input &&
            "endsAt" in input
        ) {
            const rawStarts = new Date((input as any).startsAt);
            const rawEnds = new Date((input as any).endsAt);
            if (!isNaN(rawStarts.getTime()) && !isNaN(rawEnds.getTime())) {
                parsedInterval = { startsAt: rawStarts, endsAt: rawEnds };
            }
        }
        if (!parsedInterval) {
            parsedInterval = { startsAt: new Date(0), endsAt: new Date(0) };
        }
    }

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

    // --- Prerequisites Evaluation ---
    const employeeStatus = profile.employee.status;
    const hasTechnicianProfile = true;
    const hasActiveSkills = profile.technicianSkills.some(
        (ts) => ts.skill.status === "ACTIVE",
    );
    const hasActiveServiceAreas = profile.technicianServiceAreas.some(
        (tsa) => tsa.serviceArea.status === "ACTIVE",
    );
    const activeRecurring = profile.technicianAvailabilities.filter(
        (a) => a.status === "ACTIVE",
    );
    const hasActiveAvailability = activeRecurring.length > 0;

    // --- Interval Evaluation ---
    let isCoveredByRecurring = false;
    let matchingAvailability: RecurringAvailabilityWindow[] = [];
    let blockingExceptions: BlockingExceptionInfo[] = [];

    if (!isInvalidInterval && parsedInterval) {
        const evalResult = evaluateIntervalAvailability(
            parsedInterval.startsAt,
            parsedInterval.endsAt,
            authorization.workspace.timezone,
            activeRecurring as any,
            profile.technicianAvailabilityExceptions as any,
        );
        isCoveredByRecurring = evalResult.isCoveredByRecurring;
        matchingAvailability = evalResult.matchingAvailability;
        blockingExceptions = evalResult.blockingExceptions;
    }

    // --- Deterministic Blocker Compilation ---
    const blockers: TechnicianAvailabilityBlocker[] = [];

    if (isInvalidInterval) {
        blockers.push("INVALID_REQUESTED_INTERVAL");
    }
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
        blockers.push("NO_RECURRING_AVAILABILITY");
    }
    if (!isInvalidInterval && !isCoveredByRecurring) {
        blockers.push("OUTSIDE_RECURRING_AVAILABILITY");
    }
    if (blockingExceptions.length > 0) {
        blockers.push("BLOCKED_BY_EXCEPTION");
    }

    const isAvailable = blockers.length === 0;

    const recurringAvailability: RecurringAvailabilityWindow[] =
        activeRecurring.map((a) => ({
            id: a.id,
            dayOfWeek: a.dayOfWeek,
            startTime: a.startTime,
            endTime: a.endTime,
        }));

    return {
        isAvailable,
        technicianProfileId: profile.id,
        employeeId: profile.employeeId,
        employeeStatus,
        hasTechnicianProfile,
        hasActiveSkills,
        hasActiveServiceAreas,
        requestedInterval: parsedInterval,
        recurringAvailability,
        matchingAvailability,
        blockingExceptions,
        blockers,
    };
}
