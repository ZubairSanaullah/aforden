import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { InvalidTechnicianProfileError } from "./technicianAvailabilityErrors";
import type { TechnicianAvailability, AvailabilityDay } from "@/generated/prisma/client";

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
 * Retrieves all weekly availability records for a TechnicianProfile within a workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Verifies TechnicianProfile belongs to the target workspace (`InvalidTechnicianProfileError`).
 *   - Deterministically orders results Monday → Sunday, then by `startTime ASC`.
 */
export async function getTechnicianAvailabilities(
    workspaceId: string,
    technicianProfileId: string,
): Promise<TechnicianAvailability[]> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
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

    // --- Retrieve Records ---
    const records = await prisma.technicianAvailability.findMany({
        where: {
            technicianProfileId,
        },
    });

    // --- Deterministic Sorting: Monday -> Sunday, then startTime ASC ---
    records.sort((a, b) => {
        const dayDiff = DAY_ORDER[a.dayOfWeek] - DAY_ORDER[b.dayOfWeek];
        if (dayDiff !== 0) return dayDiff;
        return a.startTime.localeCompare(b.startTime);
    });

    return records;
}
