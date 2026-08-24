import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { transitionPartStatusSchema } from "./part.schemas";
import {
    PartNotFoundError,
} from "./partErrors";
import type { PartDetailViewModel } from "./part.types";

/**
 * Transitions the operational lifecycle status of a Part (ACTIVE <-> INACTIVE).
 *
 * Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership.
 *   2. PERMISSION: Assert caller holds PERMISSIONS.PARTS_UPDATE.
 *   3. VALIDATION: Parse input status payload.
 *   4. RESOLUTION: Look up Part in workspace.
 *   5. BUSINESS LOGIC (Idempotent):
 *      - If the part is already in the target status, cleanly returns the current view model without error.
 *   6. PERSISTENCE: Mutate status in database.
 *   7. READ MODEL: Return updated Part shaped as PartDetailViewModel.
 */
export async function transitionPartStatus(
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

    // --- 3. Validate Input ---
    const data = transitionPartStatusSchema.parse(input);

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

    // --- 5. Idempotency Check: Return immediately if already at target status ---
    if (existing.status === data.status) {
        return {
            id: existing.id,
            workspaceId: existing.workspaceId,
            name: existing.name,
            sku: existing.sku,
            description: existing.description,
            unitOfMeasure: existing.unitOfMeasure,
            unitCost:
                existing.unitCost !== null ? Number(existing.unitCost) : null,
            minimumStockLevel:
                existing.minimumStockLevel !== null
                    ? Number(existing.minimumStockLevel)
                    : null,
            status: existing.status,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
        };
    }

    // --- 6. Persist Status Mutation ---
    try {
        const updated = await prisma.part.update({
            where: {
                id: partId,
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
        throw error instanceof Error
            ? error
            : new Error("Failed to update part status.");
    }
}
