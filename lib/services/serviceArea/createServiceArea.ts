import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createServiceAreaSchema } from "@/lib/validations/serviceArea";
import { ServiceAreaAlreadyExistsError } from "./serviceAreaErrors";
import type { ServiceArea } from "@/generated/prisma/client";

/**
 * Creates a ServiceArea within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`createServiceAreaSchema`).
 *   - ServiceArea name is unique within the workspace (`@@unique([workspaceId, name])`).
 *   - ServiceArea is strictly created within `workspaceId`.
 */
export async function createServiceArea(
    workspaceId: string,
    input: unknown,
): Promise<ServiceArea> {
    // --- Validate Input ---
    const data = createServiceAreaSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify Scoped Name Uniqueness ---
    const existing = await prisma.serviceArea.findUnique({
        where: {
            workspaceId_name: {
                workspaceId,
                name: data.name,
            },
        },
    });

    if (existing) {
        throw new ServiceAreaAlreadyExistsError();
    }

    // --- Create ServiceArea ---
    const serviceArea = await prisma.serviceArea.create({
        data: {
            workspaceId,
            name: data.name,
            description: data.description ?? null,
            status: data.status,
        },
    });

    return serviceArea;
}
