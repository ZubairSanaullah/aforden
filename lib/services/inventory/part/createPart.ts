import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createPartSchema } from "./part.schemas";
import { PartStatus } from "@/generated/prisma/client";
import {
    DuplicatePartNameError,
    DuplicatePartSkuError,
} from "./partErrors";
import type { PartDetailViewModel } from "./part.types";

/**
 * Creates a new catalog Part within an authorized workspace.
 *
 * 7-Stage Execution Pipeline:
 *   1. AUTHENTICATION: Verify active session & workspace membership via requireWorkspaceAuthorization().
 *   2. PERMISSION: Assert caller holds PERMISSIONS.PARTS_CREATE (OWNER, ADMIN, MANAGER).
 *   3. VALIDATION: Parse input payload through createPartSchema.
 *   4. RESOLUTION & INVARIANTS:
 *      - Verify name uniqueness within workspace.
 *      - Verify SKU uniqueness within workspace (if non-null SKU is provided).
 *   5. BUSINESS LOGIC: Always set initial status to ACTIVE.
 *   6. PERSISTENCE: Insert Part record in database with Prisma error handling.
 *   7. READ MODEL: Return created Part shaped as PartDetailViewModel.
 */
export async function createPart(
    workspaceId: string,
    input: unknown,
): Promise<PartDetailViewModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce PARTS_CREATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.PARTS_CREATE,
    );

    // --- 3. Validate Input Payload ---
    const data = createPartSchema.parse(input);

    // --- 4. Relational Resolution & Invariant Verification ---
    const existingName = await prisma.part.findFirst({
        where: {
            workspaceId,
            name: data.name,
        },
    });

    if (existingName) {
        throw new DuplicatePartNameError();
    }

    if (data.sku) {
        const existingSku = await prisma.part.findFirst({
            where: {
                workspaceId,
                sku: data.sku,
            },
        });

        if (existingSku) {
            throw new DuplicatePartSkuError();
        }
    }

    // --- 5 & 6. Persistence & Error Handling ---
    try {
        const created = await prisma.part.create({
            data: {
                workspaceId,
                name: data.name,
                sku: data.sku,
                description: data.description,
                unitOfMeasure: data.unitOfMeasure,
                unitCost:
                    data.unitCost !== null && data.unitCost !== undefined
                        ? data.unitCost
                        : null,
                minimumStockLevel:
                    data.minimumStockLevel !== null &&
                    data.minimumStockLevel !== undefined
                        ? data.minimumStockLevel
                        : null,
                status: PartStatus.ACTIVE,
            },
        });

        // --- 7. Canonical Read Model Mapping ---
        return {
            id: created.id,
            workspaceId: created.workspaceId,
            name: created.name,
            sku: created.sku,
            description: created.description,
            unitOfMeasure: created.unitOfMeasure,
            unitCost:
                created.unitCost !== null ? Number(created.unitCost) : null,
            minimumStockLevel:
                created.minimumStockLevel !== null
                    ? Number(created.minimumStockLevel)
                    : null,
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
            const target = error?.meta?.target;
            if (Array.isArray(target) && target.includes("sku")) {
                throw new DuplicatePartSkuError();
            }
            if (Array.isArray(target) && target.includes("name")) {
                throw new DuplicatePartNameError();
            }
            // Generic collision fallback
            if (data.sku) {
                throw new DuplicatePartSkuError();
            }
            throw new DuplicatePartNameError();
        }

        throw error instanceof Error
            ? error
            : new Error("Failed to create part catalog record.");
    }
}
