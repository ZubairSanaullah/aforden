import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createInventoryLocationSchema } from "./inventoryLocation.schemas";
import {
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
 * Creates a new InventoryLocation within an authorized workspace.
 *
 * 7-Stage Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership via requireWorkspaceAuthorization().
 *   2. PERMISSION: Assert caller holds PERMISSIONS.INVENTORY_LOCATIONS_MANAGE (OWNER, ADMIN, MANAGER).
 *   3. VALIDATION: Parse input payload through createInventoryLocationSchema.
 *   4. RESOLUTION & INVARIANTS:
 *      - Verify name uniqueness within workspace.
 *      - Verify code uniqueness within workspace (if non-null code provided).
 *      - If TECHNICIAN_STOCK, verify technicianProfile belongs to workspace.
 *      - If TECHNICIAN_STOCK, verify no ACTIVE stock location already exists for technicianProfile in workspace.
 *   5. BUSINESS LOGIC: Always set initial status to ACTIVE.
 *   6. PERSISTENCE: Insert InventoryLocation record in database with workspace scoping and error handling.
 *   7. READ MODEL: Return created location shaped as InventoryLocationDetailViewModel.
 */
export async function createInventoryLocation(
    workspaceId: string,
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
    const data = createInventoryLocationSchema.parse(input);

    // --- 4. Relational Resolution & Invariant Verification ---
    const existingName = await prisma.inventoryLocation.findFirst({
        where: {
            workspaceId,
            name: data.name,
        },
    });

    if (existingName) {
        throw new DuplicateInventoryLocationError();
    }

    if (data.code) {
        const existingCode = await prisma.inventoryLocation.findFirst({
            where: {
                workspaceId,
                code: data.code,
            },
        });

        if (existingCode) {
            throw new DuplicateInventoryLocationError();
        }
    }

    if (data.locationType === InventoryLocationType.TECHNICIAN_STOCK) {
        const techProfile = await prisma.technicianProfile.findFirst({
            where: {
                id: data.technicianProfileId!,
                employee: {
                    workspaceId,
                },
            },
        });

        if (!techProfile) {
            throw new TechnicianProfileNotFoundError();
        }

        const existingTechStock = await prisma.inventoryLocation.findFirst({
            where: {
                workspaceId,
                technicianProfileId: data.technicianProfileId,
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                status: InventoryLocationStatus.ACTIVE,
            },
        });

        if (existingTechStock) {
            throw new TechnicianStockLocationAlreadyExistsError();
        }
    }

    // --- 5 & 6. Persistence & Error Handling ---
    try {
        const created = await prisma.inventoryLocation.create({
            data: {
                workspaceId,
                name: data.name,
                code: data.code,
                locationType: data.locationType,
                technicianProfileId: data.technicianProfileId,
                addressLine1: data.addressLine1,
                addressLine2: data.addressLine2,
                city: data.city,
                state: data.state,
                postalCode: data.postalCode,
                country: data.country,
                notes: data.notes,
                status: InventoryLocationStatus.ACTIVE,
            },
        });

        // --- 7. Canonical Read Model Mapping ---
        return {
            id: created.id,
            workspaceId: created.workspaceId,
            name: created.name,
            code: created.code,
            locationType: created.locationType,
            technicianProfileId: created.technicianProfileId,
            addressLine1: created.addressLine1,
            addressLine2: created.addressLine2,
            city: created.city,
            state: created.state,
            postalCode: created.postalCode,
            country: created.country,
            notes: created.notes,
            status: created.status,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
        };
    } catch (error: any) {
        const isUniqueCollision =
            error?.code === "P2002" ||
            (typeof error?.message === "string" &&
                error.message.includes("Unique constraint failed"));

        if (isUniqueCollision) {
            throw new DuplicateInventoryLocationError();
        }

        throw error instanceof Error
            ? error
            : new Error("Failed to create inventory location record.");
    }
}
