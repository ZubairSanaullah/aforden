import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { AssetOperationalSummary } from "./asset.types";

/**
 * Retrieves aggregate operational metrics and status/category distributions for the Asset dashboard.
 *
 * Operational Metrics (Phase 1.7.1 §12.1):
 *   - totalAssets: Total number of assets registered in the workspace.
 *   - Status breakdown: operationalAssets, degradedAssets, outOfServiceAssets, inStorageAssets, decommissionedAssets, retiredAssets.
 *   - criticalOutOfServiceAssets: Count of OUT_OF_SERVICE equipment requiring urgent remediation.
 *   - byCategory: Category counts ordered by sortOrder ascending, plus an "Uncategorized" bucket for assets where categoryId is null.
 *
 * Security & Isolation:
 *   - Workspace-scoped (`workspaceId`).
 *   - Enforces `PERMISSIONS.ASSETS_VIEW`.
 *   - Aggregated via grouped Prisma queries without N+1 loops.
 */
export async function getAssetOperationalSummary(
    workspaceId: string,
): Promise<AssetOperationalSummary> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce ASSETS_VIEW permission ---
    assertPermission(authorization.membership.role, PERMISSIONS.ASSETS_VIEW);

    // --- 3. Parallel Aggregation Execution ---
    const [
        statusGroups,
        categories,
        uncategorizedCount,
        criticalOutOfServiceCount,
        totalAssets,
    ] = await Promise.all([
        // Status counts breakdown
        prisma.asset.groupBy({
            by: ["status"],
            where: { workspaceId },
            _count: { _all: true },
        }),

        // Categories with their asset counts
        prisma.assetCategory.findMany({
            where: { workspaceId },
            select: {
                id: true,
                name: true,
                _count: {
                    select: {
                        assets: {
                            where: { workspaceId },
                        },
                    },
                },
            },
            orderBy: {
                sortOrder: "asc",
            },
        }),

        // Assets with null categoryId
        prisma.asset.count({
            where: {
                workspaceId,
                categoryId: null,
            },
        }),

        // Critical infrastructure equipment currently out of service
        prisma.asset.count({
            where: {
                workspaceId,
                status: "OUT_OF_SERVICE",
                tags: {
                    has: "critical-infrastructure",
                },
            },
        }),

        // Total assets count
        prisma.asset.count({
            where: { workspaceId },
        }),
    ]);

    // Map status groups to counts
    const statusMap = new Map<string, number>();
    for (const group of statusGroups) {
        statusMap.set(group.status, group._count._all);
    }

    const operationalAssets = statusMap.get("OPERATIONAL") ?? 0;
    const degradedAssets = statusMap.get("DEGRADED") ?? 0;
    const outOfServiceAssets = statusMap.get("OUT_OF_SERVICE") ?? 0;
    const inStorageAssets = statusMap.get("IN_STORAGE") ?? 0;
    const decommissionedAssets = statusMap.get("DECOMMISSIONED") ?? 0;
    const retiredAssets = statusMap.get("RETIRED") ?? 0;

    // Build category distribution list
    const byCategory: Array<{
        categoryId: string | null;
        categoryName: string;
        count: number;
    }> = categories.map((cat) => ({
        categoryId: cat.id,
        categoryName: cat.name,
        count: cat._count.assets,
    }));

    if (uncategorizedCount > 0) {
        byCategory.push({
            categoryId: null,
            categoryName: "Uncategorized",
            count: uncategorizedCount,
        });
    }

    return {
        workspaceId,
        totalAssets,
        operationalAssets,
        degradedAssets,
        outOfServiceAssets,
        criticalOutOfServiceAssets: criticalOutOfServiceCount,
        inStorageAssets,
        decommissionedAssets,
        retiredAssets,
        byCategory,
    };
}
