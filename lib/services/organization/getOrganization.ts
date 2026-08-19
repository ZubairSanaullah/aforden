import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import type { Organization } from "@/generated/prisma/client";

/**
 * Retrieves the Organization (business profile) for a given workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be authenticated.
 *   - Caller must have an ACTIVE workspace membership in the target workspace.
 *   - Query is strictly scoped by `workspaceId` (never un-scoped ID lookups).
 *   - Returns `Organization | null` (if no organization profile has been created yet).
 */
export async function getOrganization(
    workspaceId: string,
): Promise<Organization | null> {
    // --- Authentication & Workspace Authorization ---
    await requireWorkspaceAuthorization(workspaceId);

    // --- Tenant-scoped query ---
    const organization = await prisma.organization.findUnique({
        where: {
            workspaceId,
        },
    });

    return organization;
}
