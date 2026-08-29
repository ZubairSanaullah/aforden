import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import {
    WorkTypeNotFoundError,
    WorkTypeUnavailableForWorkOrderError,
} from "./workTypeErrors";
import type { WorkTypeWorkOrderConsumptionModel } from "./workType.types";

/**
 * Resolves a WorkType for downstream WorkOrder creation (Phase 1.6).
 *
 * Security & Invariants:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_VIEW permission.
 *   - Target lookup is strictly tenant-scoped (`where: { id: workTypeId, workspaceId }`).
 *   - If not found in target workspace, throws `WorkTypeNotFoundError` (prevents cross-tenant leaks).
 *   - Asserts dynamic operational availability (`workType.status === ACTIVE && catalog.status === ACTIVE`).
 *   - If unavailable, throws `WorkTypeUnavailableForWorkOrderError`.
 *   - Returns the exact operational values needed for Phase 1.6 snapshotting.
 */
export async function getWorkTypeForWorkOrderConsumption(
    workspaceId: string,
    workTypeId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<WorkTypeWorkOrderConsumptionModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // --- 2. RBAC: Enforce SERVICE_CATALOG_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_VIEW,
    );

    // --- 3. Scoped WorkType Lookup with Parent Catalog ---
    const existing = await prisma.workType.findFirst({
        where: {
            id: workTypeId,
            workspaceId,
        },
        include: {
            catalog: true,
        },
    });

    if (!existing) {
        throw new WorkTypeNotFoundError();
    }

    // --- 4. Evaluate Dynamic Operational Availability ---
    const isAvailable =
        existing.status === "ACTIVE" && existing.catalog.status === "ACTIVE";

    if (!isAvailable) {
        throw new WorkTypeUnavailableForWorkOrderError();
    }

    // --- 5. Return Authoritative Consumption Snapshot Model ---
    return {
        workTypeId: existing.id,
        workspaceId: existing.workspaceId,
        catalogId: existing.catalogId,
        name: existing.name,
        code: existing.code,
        estimatedDuration: existing.estimatedDuration,
        isAvailableForWorkOrder: true,
    };
}
