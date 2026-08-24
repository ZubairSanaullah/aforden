import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateInventoryLocationSchema } from "./inventoryLocation.schemas";
import {
    InventoryLocationNotFoundError,
    DuplicateInventoryLocationError,
    TechnicianStockLocationAlreadyExistsError,
} from "./inventoryLocationErrors";
import { TechnicianProfileNotFoundError } from "@/lib/services/technicianProfile/technicianProfileErrors";
import {
    InventoryLocationStatus,
    InventoryLocationType,
} from "@/generated/prisma/client";
import type { InventoryLocationDetailViewModel } from "./inventoryLocation.types";

/**
 * Updates attributes of an existing InventoryLocation within an authorized workspace.
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_LOCATIONS_MANAGE.
 *   3. VALIDATION: Parse input payload through updateInventoryLocationSchema (forbids status changes).
 *   4. RESOLUTION: Find target location by { id, workspaceId }.
 *   5. INVARIANT VERIFICATION:
 *      - Verify name uniqueness if name is updated.
 *      - Verify code uniqueness if code is updated.
 *      - Verify TECHNICIAN_STOCK invariants if locationType or technicianProfileId is updated.
 *   6. PERSISTENCE: Execute workspace-scoped database update.
 *   7. READ MODEL: Return updated location shaped as InventoryLocationDetailViewModel.
 */
export async function updateInventoryLocation(
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
    const data = updateInventoryLocationSchema.parse(input);

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

    // --- 5. Verify Uniqueness & Relational Invariants ---
    if (data.name !== undefined && data.name !== existing.name) {
        const conflictName = await prisma.inventoryLocation.findFirst({
            where: {
                workspaceId,
                name: data.name,
                id: { not: locationId },
            },
        });

        if (conflictName) {
            throw new DuplicateInventoryLocationError();
        }
    }

    if (
        data.code !== undefined &&
        data.code !== existing.code &&
        data.code !== null
    ) {
        const conflictCode = await prisma.inventoryLocation.findFirst({
            where: {
                workspaceId,
                code: data.code,
                id: { not: locationId },
            },
        });

        if (conflictCode) {
            throw new DuplicateInventoryLocationError();
        }
    }

    const effectiveType = data.locationType ?? existing.locationType;
    const effectiveTechProfileId =
        data.technicianProfileId !== undefined
            ? data.technicianProfileId
            : existing.technicianProfileId;

    if (effectiveType === InventoryLocationType.TECHNICIAN_STOCK) {
        if (!effectiveTechProfileId) {
            throw new Error(
                "technicianProfileId is required when locationType is TECHNICIAN_STOCK.",
            );
        }

        const techProfile = await prisma.technicianProfile.findFirst({
            where: {
                id: effectiveTechProfileId,
                employee: {
                    workspaceId,
                },
            },
        });

        if (!techProfile) {
            throw new TechnicianProfileNotFoundError();
        }

        const conflictTechStock = await prisma.inventoryLocation.findFirst({
            where: {
                workspaceId,
                technicianProfileId: effectiveTechProfileId,
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                status: InventoryLocationStatus.ACTIVE,
                id: { not: locationId },
            },
        });

        if (conflictTechStock) {
            throw new TechnicianStockLocationAlreadyExistsError();
        }
    }

    // --- 6. Persist Updates with Workspace Scoping ---
    try {
        const updateData: any = {};

        if (data.name !== undefined) updateData.name = data.name;
        if (data.code !== undefined) updateData.code = data.code;
        if (data.locationType !== undefined)
            updateData.locationType = data.locationType;
        if (data.addressLine1 !== undefined)
            updateData.addressLine1 = data.addressLine1;
        if (data.addressLine2 !== undefined)
            updateData.addressLine2 = data.addressLine2;
        if (data.city !== undefined) updateData.city = data.city;
        if (data.state !== undefined) updateData.state = data.state;
        if (data.postalCode !== undefined)
            updateData.postalCode = data.postalCode;
        if (data.country !== undefined) updateData.country = data.country;
        if (data.notes !== undefined) updateData.notes = data.notes;

        // Authoritative invariant: technicianProfileId is ONLY allowed on TECHNICIAN_STOCK locations
        if (effectiveType !== InventoryLocationType.TECHNICIAN_STOCK) {
            updateData.technicianProfileId = null;
        } else {
            updateData.technicianProfileId = effectiveTechProfileId;
        }

        const updated = await prisma.inventoryLocation.update({
            where: {
                id: locationId,
                workspaceId,
            },
            data: updateData,
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
        if (
            error instanceof DuplicateInventoryLocationError ||
            error instanceof TechnicianStockLocationAlreadyExistsError ||
            error instanceof TechnicianProfileNotFoundError
        ) {
            throw error;
        }

        const isUniqueCollision =
            error?.code === "P2002" ||
            (typeof error?.message === "string" &&
                error.message.includes("Unique constraint failed"));

        if (isUniqueCollision) {
            throw new DuplicateInventoryLocationError();
        }

        throw error instanceof Error
            ? error
            : new Error("Failed to update inventory location record.");
    }
}
