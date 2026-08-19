import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateOrganizationSchema } from "@/lib/validations/organization";
import { OrganizationNotFoundError } from "./organizationErrors";
import type { Organization } from "@/generated/prisma/client";

/**
 * Updates an existing organization's business profile within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the SETTINGS_UPDATE permission (OWNER or ADMIN).
 *   - Raw inputs are validated via Zod (`updateOrganizationSchema`).
 *   - Tenant-scoped: only updates the organization belonging to `workspaceId`.
 *   - Distinguishes between omitted/undefined fields (not modified) and null (cleared).
 *   - Throws `OrganizationNotFoundError` if no organization exists for the workspace.
 */
export async function updateOrganization(
    workspaceId: string,
    input: unknown,
): Promise<Organization> {
    // --- Validate Input ---
    const data = updateOrganizationSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce SETTINGS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SETTINGS_UPDATE,
    );

    // --- Verify Organization Exists (Tenant-Scoped) ---
    const existing = await prisma.organization.findUnique({
        where: {
            workspaceId,
        },
        select: {
            id: true,
            workspaceId: true,
        },
    });

    if (!existing) {
        throw new OrganizationNotFoundError();
    }

    // --- Execute Update (Preserves undefined vs null semantics) ---
    const updated = await prisma.organization.update({
        where: {
            workspaceId,
        },
        data,
    });

    return updated;
}
