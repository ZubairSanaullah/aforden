import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updatePartSchema } from "./part.schemas";
import {
    PartNotFoundError,
    DuplicatePartNameError,
    DuplicatePartSkuError,
} from "./partErrors";
import type { PartDetailViewModel } from "./part.types";

/**
 * Updates an existing catalog Part within an authorized workspace.
 *
 * 7-Stage Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.PARTS_UPDATE.
 *   3. VALIDATION: Parse input payload through updatePartSchema (rejects status mutations).
 *   4. RESOLUTION: Look up existing Part in workspace.
 *   5. BUSINESS LOGIC & INVARIANTS:
 *      - Re-validate name uniqueness if name is changed.
 *      - Re-validate SKU uniqueness if non-null SKU is changed.
 *   6. PERSISTENCE: Apply updates in Prisma with collision error handling.
 *   7. READ MODEL: Return updated Part shaped as PartDetailViewModel.
 */
export async function updatePart(
    workspaceId: string,
    partId: string,
    input: unknown,
): Promise<PartDetailViewModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce PARTS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.PARTS_UPDATE,
    );

    // --- 3. Validate Input Payload ---
    const data = updatePartSchema.parse(input);

    // --- 4. Locate Existing Part in Workspace ---
    const existing = await prisma.part.findFirst({
        where: {
            id: partId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new PartNotFoundError();
    }

    // --- 5. Uniqueness Invariant Verification ---
    if (data.name !== undefined && data.name !== existing.name) {
        const conflictName = await prisma.part.findFirst({
            where: {
                workspaceId,
                name: data.name,
                id: { not: partId },
            },
        });

        if (conflictName) {
            throw new DuplicatePartNameError();
        }
    }

    if (
        data.sku !== undefined &&
        data.sku !== null &&
        data.sku !== existing.sku
    ) {
        const conflictSku = await prisma.part.findFirst({
            where: {
                workspaceId,
                sku: data.sku,
                id: { not: partId },
            },
        });

        if (conflictSku) {
            throw new DuplicatePartSkuError();
        }
    }

    // --- 6. Persist Updates ---
    try {
        const updateData: any = {};

        if (data.name !== undefined) updateData.name = data.name;
        if (data.sku !== undefined) updateData.sku = data.sku;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.unitOfMeasure !== undefined) updateData.unitOfMeasure = data.unitOfMeasure;
        if (data.unitCost !== undefined) updateData.unitCost = data.unitCost;
        if (data.minimumStockLevel !== undefined)
            updateData.minimumStockLevel = data.minimumStockLevel;

        const updated = await prisma.part.update({
            where: {
                id: partId,
                workspaceId,
            },
            data: updateData,
        });

        // --- 7. Canonical Read Model Projection ---
        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            name: updated.name,
            sku: updated.sku,
            description: updated.description,
            unitOfMeasure: updated.unitOfMeasure,
            unitCost:
                updated.unitCost !== null ? Number(updated.unitCost) : null,
            minimumStockLevel:
                updated.minimumStockLevel !== null
                    ? Number(updated.minimumStockLevel)
                    : null,
            status: updated.status,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        };
    } catch (error: any) {
        if (
            error instanceof DuplicatePartNameError ||
            error instanceof DuplicatePartSkuError
        ) {
            throw error;
        }

        const isUniqueCollision =
            error?.code === "P2002" ||
            (typeof error?.message === "string" &&
                error.message.includes("Unique constraint failed"));

        if (isUniqueCollision) {
            const target = error?.meta?.target;
            if (Array.isArray(target) && target.includes("sku")) {
                throw new DuplicatePartSkuError();
            }
            if (Array.isArray(target) && target.includes("name")) {
                throw new DuplicatePartNameError();
            }
            if (data.sku) {
                throw new DuplicatePartSkuError();
            }
            throw new DuplicatePartNameError();
        }

        throw error instanceof Error
            ? error
            : new Error("Failed to update part.");
    }
}
