import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { AssetCategoryNotFoundError } from "./assetCategoryErrors";
import { toAssetCategoryViewModel } from "./getAssetCategories";
import type { AssetCategoryViewModel } from "./assetCategory.types";

/**
 * Toggles an AssetCategory's status to INACTIVE.
 *
 * Security & Invariants (Phase 1.7.1 §6.3):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC check: Caller must hold `PERMISSIONS.ASSET_CATEGORIES_MANAGE` (OWNER, ADMIN, MANAGER).
 *   3. Locate target Category in workspace (throws 404 `AssetCategoryNotFoundError` if missing or cross-tenant).
 *   4. Updates `status` to "INACTIVE".
 *   5. Returns updated `AssetCategoryViewModel`.
 */
export async function deactivateAssetCategory(
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

    // --- 3. Locate Target Category in Workspace ---
    const existing = await prisma.assetCategory.findFirst({
        where: {
            id: categoryId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new AssetCategoryNotFoundError();
    }

    // --- 4. Persistence ---
    const updated = await prisma.assetCategory.update({
        where: {
            id: categoryId,
        },
        data: {
            status: "INACTIVE",
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
}
