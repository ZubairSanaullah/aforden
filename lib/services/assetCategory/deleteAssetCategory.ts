import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    AssetCategoryNotFoundError,
    AssetCategoryDeletionNotAllowedError,
} from "./assetCategoryErrors";
import { toAssetCategoryViewModel } from "./getAssetCategories";
import type { AssetCategoryViewModel } from "./assetCategory.types";

/**
 * Administratively hard-deletes an unreferenced AssetCategory from an authorized workspace.
 *
 * Security & Invariants (Phase 1.7.1 §6.3, §13.2):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC check: Caller must hold `PERMISSIONS.ASSET_CATEGORIES_MANAGE` (OWNER, ADMIN, MANAGER).
 *   3. Locate target Category in workspace (throws 404 `AssetCategoryNotFoundError` if missing or cross-tenant).
 *   4. Check downstream Asset references:
 *      - If any `Asset` references this `categoryId`, throw 409 `AssetCategoryDeletionNotAllowedError`.
 *   5. Persistence: Delete `AssetCategory` row, with defensive P2003 translation.
 *   6. Returns deleted `AssetCategoryViewModel` snapshot.
 */
export async function deleteAssetCategory(
    workspaceId: string,
    categoryId: string,
): Promise<AssetCategoryViewModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce ASSET_CATEGORIES_MANAGE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.ASSET_CATEGORIES_MANAGE,
    );

    // --- 3. Locate Target Category in Workspace with Assets Count ---
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

    // --- 4. Assert Zero Downstream Asset References ---
    const assetsCount = existing._count?.assets ?? 0;
    if (assetsCount > 0) {
        throw new AssetCategoryDeletionNotAllowedError(
            `Cannot delete asset category '${existing.name}' because it is referenced by ${assetsCount} asset(s).`,
        );
    }

    // --- 5. Persistence with Error Translation ---
    try {
        await prisma.assetCategory.delete({
            where: {
                id: categoryId,
            },
        });

        return toAssetCategoryViewModel(existing);
    } catch (error: any) {
        if (error?.code === "P2025") {
            throw new AssetCategoryNotFoundError();
        }
        if (error?.code === "P2003") {
            throw new AssetCategoryDeletionNotAllowedError(
                `Cannot delete asset category '${existing.name}' because active downstream references exist in the database.`,
            );
        }
        throw error;
    }
}
