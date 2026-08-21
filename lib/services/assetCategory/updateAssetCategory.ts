import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateAssetCategorySchema } from "./assetCategory.schemas";
import {
    AssetCategoryNotFoundError,
    AssetCategoryAlreadyExistsError,
} from "./assetCategoryErrors";
import { toAssetCategoryViewModel } from "./getAssetCategories";
import type { AssetCategoryViewModel } from "./assetCategory.types";

/**
 * Updates an existing AssetCategory in an authorized workspace.
 *
 * Security & Validation Invariants (Phase 1.7.1 §6.3, §13.2):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC check: Caller must hold `PERMISSIONS.ASSET_CATEGORIES_MANAGE` (OWNER, ADMIN, MANAGER).
 *   3. Locate target Category in workspace (throws 404 `AssetCategoryNotFoundError` if missing or cross-tenant).
 *   4. Parse and validate input payload using `updateAssetCategorySchema`.
 *   5. Uniqueness assertion on name / code if changed.
 *   6. Persistence: Update `AssetCategory` row.
 *   7. Returns canonical updated `AssetCategoryViewModel`.
 */
export async function updateAssetCategory(
    workspaceId: string,
    categoryId: string,
    rawInput: unknown,
): Promise<AssetCategoryViewModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce ASSET_CATEGORIES_MANAGE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.ASSET_CATEGORIES_MANAGE,
    );

    // --- 3. Locate Target Category in Workspace ---
    const existing = await prisma.assetCategory.findFirst({
        where: {
            id: categoryId,
            workspaceId,
        },
        include: {
            _count: {
                select: {
                    assets: true,
                },
            },
        },
    });

    if (!existing) {
        throw new AssetCategoryNotFoundError();
    }

    // --- 4. Input Validation ---
    const data = updateAssetCategorySchema.parse(rawInput);

    // --- 5. Uniqueness Assertions (if name or code is being modified) ---
    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
        const duplicateName = await prisma.assetCategory.findFirst({
            where: {
                workspaceId,
                id: { not: categoryId },
                name: {
                    equals: data.name,
                    mode: "insensitive",
                },
            },
        });

        if (duplicateName) {
            throw new AssetCategoryAlreadyExistsError(
                `An asset category with the name '${data.name}' already exists in this workspace.`,
            );
        }
    }

    if (
        data.code !== undefined &&
        data.code !== null &&
        data.code.toLowerCase() !== (existing.code ?? "").toLowerCase()
    ) {
        const duplicateCode = await prisma.assetCategory.findFirst({
            where: {
                workspaceId,
                id: { not: categoryId },
                code: {
                    equals: data.code,
                    mode: "insensitive",
                },
            },
        });

        if (duplicateCode) {
            throw new AssetCategoryAlreadyExistsError(
                `An asset category with the code '${data.code}' already exists in this workspace.`,
            );
        }
    }

    // --- 6. Persistence ---
    try {
        const updated = await prisma.assetCategory.update({
            where: {
                id: categoryId,
            },
            data: {
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.code !== undefined ? { code: data.code } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.status !== undefined ? { status: data.status } : {}),
                ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
            },
            include: {
                _count: {
                    select: {
                        assets: true,
                    },
                },
            },
        });

        return toAssetCategoryViewModel(updated);
    } catch (error: any) {
        if (error?.code === "P2025") {
            throw new AssetCategoryNotFoundError();
        }
        if (error?.code === "P2002") {
            throw new AssetCategoryAlreadyExistsError();
        }
        throw error;
    }
}
