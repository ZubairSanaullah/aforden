import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    updateTechnicianAvailabilityStatusSchema,
    parseTimeToMinutes,
} from "@/lib/validations/technicianAvailability";
import {
    TechnicianAvailabilityNotFoundError,
    AvailabilityOverlapError,
} from "./technicianAvailabilityErrors";
import type { TechnicianAvailability } from "@/generated/prisma/client";

/**
 * Updates a TechnicianAvailability record status (ACTIVE / INACTIVE).
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateTechnicianAvailabilityStatusSchema`).
 *   - Lookup is strictly tenant-scoped (`where: { id: availabilityId, technicianProfile: { employee: { workspaceId } } }`).
 *   - Reactivating an inactive schedule window (to ACTIVE) re-runs active overlap validation.
 *   - Updates only the `status` field.
 */
export async function updateTechnicianAvailabilityStatus(
    workspaceId: string,
    availabilityId: string,
    input: unknown,
): Promise<TechnicianAvailability> {
    // --- Validate Input ---
    const data = updateTechnicianAvailabilityStatusSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify TechnicianAvailability Exists in Workspace ---
    const existing = await prisma.technicianAvailability.findFirst({
        where: {
            id: availabilityId,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
    });

    if (!existing) {
        throw new TechnicianAvailabilityNotFoundError();
    }

    // --- Overlap Check on Reactivation ---
    if (data.status === "ACTIVE" && existing.status !== "ACTIVE") {
        const activeRecords = await prisma.technicianAvailability.findMany({
            where: {
                technicianProfileId: existing.technicianProfileId,
                dayOfWeek: existing.dayOfWeek,
                status: "ACTIVE",
                id: { not: availabilityId },
            },
        });

        const targetStart = parseTimeToMinutes(existing.startTime);
        const targetEnd = parseTimeToMinutes(existing.endTime);

        for (const rec of activeRecords) {
            const recStart = parseTimeToMinutes(rec.startTime);
            const recEnd = parseTimeToMinutes(rec.endTime);

            if (targetStart < recEnd && recStart < targetEnd) {
                throw new AvailabilityOverlapError(
                    `Reactivating availability window ${existing.startTime}-${existing.endTime} on ${existing.dayOfWeek} overlaps with existing active window ${rec.startTime}-${rec.endTime}.`,
                );
            }
        }
    }

    // --- Execute Status Update ---
    const updated = await prisma.technicianAvailability.update({
        where: {
            id: availabilityId,
        },
        data: {
            status: data.status,
        },
    });

    return updated;
}
