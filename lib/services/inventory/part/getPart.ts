import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { PartNotFoundError } from "./partErrors";
import type { PartDetailViewModel } from "./part.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Retrieves a single Part from the catalog by ID within an authorized workspace.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.PARTS_VIEW.
 *   3. RESOLUTION: Look up Part strictly scoped to workspaceId.
 *   4. READ MODEL: Map and return PartDetailViewModel or throw PartNotFoundError.
 */
export async function getPart(
    workspaceId: string,
    partId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<PartDetailViewModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // --- 2. RBAC: Enforce PARTS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.PARTS_VIEW,
    );

    // --- 3. Locate Target Part in Workspace ---
    const part = await prisma.part.findFirst({
        where: {
            id: partId,
            workspaceId,
        },
    });

    if (!part) {
        throw new PartNotFoundError();
    }

    // --- 4. Canonical Read Model Projection ---
    return {
        id: part.id,
        workspaceId: part.workspaceId,
        name: part.name,
        sku: part.sku,
        description: part.description,
        unitOfMeasure: part.unitOfMeasure,
        unitCost: part.unitCost !== null ? Number(part.unitCost) : null,
        minimumStockLevel:
            part.minimumStockLevel !== null
                ? Number(part.minimumStockLevel)
                : null,
        status: part.status,
        createdAt: part.createdAt,
        updatedAt: part.updatedAt,
    };
}
