import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { WorkTypeOperationalSummary } from "./workType.types";

/**
 * Retrieves aggregate operational statistics for WorkTypes within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_VIEW permission.
 *   - Aggregations are strictly scoped to `workspaceId`.
 *   - Computes effective availability (`isAvailableForWorkOrder`).
 */
export async function getWorkTypeOperationalSummary(
    workspaceId: string,
): Promise<WorkTypeOperationalSummary> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SERVICE_CATALOG_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_VIEW,
    );

    // --- 3. Parallel Workspace-Scoped Aggregations ---
    const [
        totalWorkTypes,
        activeWorkTypes,
        inactiveWorkTypes,
        availableWorkTypes,
        totalCatalogs,
    ] = await Promise.all([
        prisma.workType.count({
            where: {
                workspaceId,
            },
        }),
        prisma.workType.count({
            where: {
                workspaceId,
                status: "ACTIVE",
            },
        }),
        prisma.workType.count({
            where: {
                workspaceId,
                status: "INACTIVE",
            },
        }),
        prisma.workType.count({
            where: {
                workspaceId,
                status: "ACTIVE",
                catalog: {
                    status: "ACTIVE",
                },
            },
        }),
        prisma.serviceCatalog.count({
            where: {
                workspaceId,
            },
        }),
    ]);

    const unavailableWorkTypes = totalWorkTypes - availableWorkTypes;

    return {
        workspaceId,
        totalWorkTypes,
        activeWorkTypes,
        inactiveWorkTypes,
        availableWorkTypes,
        unavailableWorkTypes,
        totalCatalogs,
    };
}
