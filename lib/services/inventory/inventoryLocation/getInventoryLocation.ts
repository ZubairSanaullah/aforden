import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { InventoryLocationNotFoundError } from "./inventoryLocationErrors";
import type { InventoryLocationDetailViewModel } from "./inventoryLocation.types";

/**
 * Retrieves a single InventoryLocation record by ID within an authorized workspace.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_LOCATIONS_VIEW.
 *   3. RESOLUTION: Find location by { id, workspaceId } tenant scope.
 *   4. READ MODEL: Return structured InventoryLocationDetailViewModel.
 */
export async function getInventoryLocation(
    workspaceId: string,
    locationId: string,
): Promise<InventoryLocationDetailViewModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_LOCATIONS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_LOCATIONS_VIEW,
    );

    // --- 3. Tenant-Scoped Point Lookup ---
    const location = await prisma.inventoryLocation.findFirst({
        where: {
            id: locationId,
            workspaceId,
        },
    });

    if (!location) {
        throw new InventoryLocationNotFoundError();
    }

    // --- 4. Canonical Read Model Projection ---
    return {
        id: location.id,
        workspaceId: location.workspaceId,
        name: location.name,
        code: location.code,
        locationType: location.locationType,
        technicianProfileId: location.technicianProfileId,
        addressLine1: location.addressLine1,
        addressLine2: location.addressLine2,
        city: location.city,
        state: location.state,
        postalCode: location.postalCode,
        country: location.country,
        notes: location.notes,
        status: location.status,
        createdAt: location.createdAt,
        updatedAt: location.updatedAt,
    };
}
