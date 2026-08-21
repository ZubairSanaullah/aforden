import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    AssetNotFoundError,
    AssetDeletionNotAllowedError,
} from "./assetErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { toAssetDetailViewModel } from "./getAsset";
import type { AssetDetailViewModel } from "./asset.types";

/**
 * Administratively hard-deletes an unreferenced Asset from an authorized workspace.
 *
 * Locked Execution Order (Phase 1.7.1 §17.1 & Phase 1.7.9):
 *   1. AUTHENTICATION: Authenticate session and active workspace membership (`requireWorkspaceAuthorization`).
 *   2. PERMISSION: Assert caller holds `PERMISSIONS.ASSETS_DELETE` and is explicitly role `OWNER` or `ADMIN`.
 *   3. VALIDATION: Assert presence and validity of `assetId`.
 *   4. RESOLUTION: Locate target asset scoped by `workspaceId` (throws 404 `AssetNotFoundError` if missing or cross-tenant).
 *   5. BUSINESS RULES:
 *      - Zero WorkOrder invariant: Assets with >= 1 downstream WorkOrder association cannot be deleted (throws 409 `AssetDeletionNotAllowedError`).
 *      - Note: AssetHistory cascades automatically upon Asset deletion (onDelete: Cascade) and does NOT block deletion.
 *   6. PERSISTENCE: Execute physical deletion in PostgreSQL with defensive P2003 / P2025 error translation.
 *   7. RETURN: Returns canonical `AssetDetailViewModel` snapshot of the deleted asset (mirroring Phase 1.6 deleteWorkOrder).
 */
export async function deleteAsset(
    workspaceId: string,
    assetId: string,
): Promise<AssetDetailViewModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    const role = authorization.membership.role;

    // --- 2. RBAC: Enforce ASSETS_DELETE permission & Hard Role Guard (OWNER / ADMIN only) ---
    assertPermission(role, PERMISSIONS.ASSETS_DELETE);

    if (role !== "OWNER" && role !== "ADMIN") {
        throw new ForbiddenError(
            "Only workspace OWNER and ADMIN roles are authorized to delete assets.",
        );
    }

    // --- 3. Input Validation ---
    if (!assetId || typeof assetId !== "string" || assetId.trim().length === 0) {
        throw new AssetNotFoundError("Asset ID must not be empty.");
    }

    // --- 4. Resolution: Tenant-Scoped Asset Lookup with Relations & WorkOrder Count ---
    const existing = await prisma.asset.findFirst({
        where: {
            id: assetId,
            workspaceId,
        },
        include: {
            customer: true,
            location: true,
            category: true,
            _count: {
                select: {
                    workOrders: true,
                },
            },
        },
    });

    if (!existing) {
        throw new AssetNotFoundError();
    }

    // --- 5. Business Rules: Enforce Zero WorkOrder Invariant ---
    const workOrderCount = existing._count?.workOrders ?? 0;
    if (workOrderCount > 0) {
        throw new AssetDeletionNotAllowedError(
            `Cannot delete asset '${existing.assetNumber}' because it is referenced by ${workOrderCount} historical work order(s). Equipment with operational history must be DECOMMISSIONED or RETIRED.`,
        );
    }

    // --- 6. Persistence: Physical Deletion with Fallback Error Translation ---
    try {
        await prisma.asset.delete({
            where: {
                id: assetId,
            },
        });

        // --- 7. Return Canonical Read Model Snapshot ---
        return toAssetDetailViewModel(existing);
    } catch (error: any) {
        if (error?.code === "P2025") {
            throw new AssetNotFoundError();
        }

        if (error?.code === "P2003") {
            throw new AssetDeletionNotAllowedError(
                "Cannot delete asset because active downstream references exist in the database.",
            );
        }

        throw error instanceof Error
            ? error
            : new Error("Failed to delete asset record.");
    }
}
