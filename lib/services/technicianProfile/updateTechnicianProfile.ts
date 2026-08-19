import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateTechnicianProfileSchema } from "@/lib/validations/technicianProfile";
import { TechnicianProfileNotFoundError } from "./technicianProfileErrors";
import type { TechnicianProfile } from "@/generated/prisma/client";

/**
 * Updates a TechnicianProfile within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`updateTechnicianProfileSchema`).
 *   - Profile lookup is strictly tenant-scoped (`where: { id: technicianProfileId, employee: { workspaceId } }`).
 *   - Distinguishes between omitted/undefined fields (not modified) and null (cleared).
 */
export async function updateTechnicianProfile(
    workspaceId: string,
    technicianProfileId: string,
    input: unknown,
): Promise<TechnicianProfile> {
    // --- Validate Input ---
    const data = updateTechnicianProfileSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify TechnicianProfile Exists in Workspace ---
    const existing = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
    });

    if (!existing) {
        throw new TechnicianProfileNotFoundError();
    }

    // --- Execute Update ---
    const updated = await prisma.technicianProfile.update({
        where: {
            id: technicianProfileId,
        },
        data,
    });

    return updated;
}
