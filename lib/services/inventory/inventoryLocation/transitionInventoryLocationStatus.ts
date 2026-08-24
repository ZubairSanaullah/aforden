import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { transitionInventoryLocationStatusSchema } from "./inventoryLocation.schemas";
import {
    InventoryLocationNotFoundError,
    TechnicianStockLocationAlreadyExistsError,
} from "./inventoryLocationErrors";
import {
    InventoryLocationStatus,
    InventoryLocationType,
} from "@/generated/prisma/client";
import type { InventoryLocationDetailViewModel } from "./inventoryLocation.types";

/**
 * Transitions the operational lifecycle status of an InventoryLocation (ACTIVE <-> INACTIVE).
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_LOCATIONS_MANAGE.
 *   3. VALIDATION: Parse input status payload.
 *   4. RESOLUTION: Look up InventoryLocation in workspace.
 *   5. BUSINESS LOGIC (Idempotent):
 *      - If the location is already in target status, cleanly returns current view model.
 *      - If reactivating a TECHNICIAN_STOCK location, verify no other ACTIVE location exists for technician.
 *   6. PERSISTENCE: Mutate status in database with workspace scoping.
 *   7. READ MODEL: Return updated location shaped as InventoryLocationDetailViewModel.
 */
export async function transitionInventoryLocationStatus(
    workspaceId: string,
    locationId: string,
    input: unknown,
): Promise<InventoryLocationDetailViewModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce INVENTORY_LOCATIONS_MANAGE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.INVENTORY_LOCATIONS_MANAGE,
    );

    // --- 3. Validate Input Payload ---
    const data = transitionInventoryLocationStatusSchema.parse(input);

    // --- 4. Resolve Target Location in Workspace ---
    const existing = await prisma.inventoryLocation.findFirst({
        where: {
            id: locationId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new InventoryLocationNotFoundError();
    }

    // --- 5. Idempotent Return if Already in Target Status ---
    if (existing.status === data.status) {
        return {
            id: existing.id,
            workspaceId: existing.workspaceId,
            name: existing.name,
            code: existing.code,
            locationType: existing.locationType,
            technicianProfileId: existing.technicianProfileId,
            addressLine1: existing.addressLine1,
            addressLine2: existing.addressLine2,
            city: existing.city,
            state: existing.state,
            postalCode: existing.postalCode,
            country: existing.country,
            notes: existing.notes,
            status: existing.status,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
        };
    }

    // --- Invariant: Exactly one active technician stock location per technician ---
    if (
        data.status === InventoryLocationStatus.ACTIVE &&
        existing.locationType === InventoryLocationType.TECHNICIAN_STOCK &&
        existing.technicianProfileId
    ) {
        const conflictTechStock = await prisma.inventoryLocation.findFirst({
            where: {
                workspaceId,
                technicianProfileId: existing.technicianProfileId,
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                status: InventoryLocationStatus.ACTIVE,
                id: { not: locationId },
            },
        });

        if (conflictTechStock) {
            throw new TechnicianStockLocationAlreadyExistsError();
        }
    }

    // --- 6. Persist Status Mutation with Workspace Scoping ---
    try {
        const updated = await prisma.inventoryLocation.update({
            where: {
                id: locationId,
                workspaceId,
            },
            data: {
                status: data.status,
            },
        });

        // --- 7. Canonical Read Model Projection ---
        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            name: updated.name,
            code: updated.code,
            locationType: updated.locationType,
            technicianProfileId: updated.technicianProfileId,
            addressLine1: updated.addressLine1,
            addressLine2: updated.addressLine2,
            city: updated.city,
            state: updated.state,
            postalCode: updated.postalCode,
            country: updated.country,
            notes: updated.notes,
            status: updated.status,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        };
    } catch (error: any) {
        if (error instanceof TechnicianStockLocationAlreadyExistsError) {
            throw error;
        }

        throw error instanceof Error
            ? error
            : new Error("Failed to transition inventory location status.");
    }
}
