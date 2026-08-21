import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { AssetCategoryNotFoundError } from "./assetCategoryErrors";
import { toAssetCategoryViewModel } from "./getAssetCategories";
import type { AssetCategoryViewModel } from "./assetCategory.types";

/**
 * Retrieves a single AssetCategory by ID within an authorized workspace.
 *
 * Security & Invariants (Phase 1.7.1 §6.3, §13.2):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC check: Caller must hold `PERMISSIONS.ASSETS_VIEW`.
 *   3. Strict tenant-scoped query (`where: { id: categoryId, workspaceId }`).
 *   4. Cross-tenant or nonexistent categories throw `AssetCategoryNotFoundError` (HTTP 404).
 *   5. Returns `AssetCategoryViewModel` including `assetsCount`.
 */
export async function getAssetCategory(
    workspaceId: string,
    categoryId: string,
): Promise<AssetCategoryViewModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce ASSETS_VIEW permission ---
    assertPermission(authorization.membership.role, PERMISSIONS.ASSETS_VIEW);

    // --- 3. Tenant-Scoped Query ---
    const category = await prisma.assetCategory.findFirst({
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

    if (!category) {
        throw new AssetCategoryNotFoundError();
    }

    return toAssetCategoryViewModel(category);
}
