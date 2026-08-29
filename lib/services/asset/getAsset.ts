import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { AssetNotFoundError } from "./assetErrors";
import type { AssetDetailViewModel } from "./asset.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Transforms a Prisma Asset record with nested relations into canonical AssetDetailViewModel.
 */
export function toAssetDetailViewModel(record: any): AssetDetailViewModel {
    return {
        id: record.id,
        workspaceId: record.workspaceId,
        assetNumber: record.assetNumber,
        name: record.name,
        status: record.status,

        manufacturer: record.manufacturer ?? null,
        modelNumber: record.modelNumber ?? null,
        serialNumber: record.serialNumber ?? null,
        subLocationNotes: record.subLocationNotes ?? null,

        installationDate: record.installationDate ?? null,
        warrantyExpiresAt: record.warrantyExpiresAt ?? null,
        purchaseDate: record.purchaseDate ?? null,
        purchaseCost:
            record.purchaseCost !== null && record.purchaseCost !== undefined
                ? Number(record.purchaseCost)
                : null,
        notes: record.notes ?? null,
        tags: record.tags ?? [],
        metadata: (record.metadata as Record<string, any>) ?? null,

        customer: record.customer
            ? {
                  id: record.customer.id,
                  customerNumber: record.customer.customerNumber ?? null,
                  name: record.customer.name,
              }
            : null,

        location: record.location
            ? {
                  id: record.location.id,
                  name: record.location.name,
                  addressLine1: record.location.addressLine1,
                  city: record.location.city,
                  state: record.location.state ?? null,
                  latitude:
                      record.location.latitude !== null &&
                      record.location.latitude !== undefined
                          ? Number(record.location.latitude)
                          : null,
                  longitude:
                      record.location.longitude !== null &&
                      record.location.longitude !== undefined
                          ? Number(record.location.longitude)
                          : null,
              }
            : null,

        category: record.category
            ? {
                  id: record.category.id,
                  name: record.category.name,
                  code: record.category.code ?? null,
              }
            : null,

        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        decommissionedAt: record.decommissionedAt ?? null,
        retiredAt: record.retiredAt ?? null,
    };
}

/**
 * Retrieves a single Asset by ID within an authorized workspace.
 *
 * Security & Scoping Invariants (Phase 1.7.1 §10, §11, §12, §15):
 *   1. Authenticate session and active workspace membership (`requireWorkspaceAuthorization`).
 *   2. RBAC check: Caller must hold `PERMISSIONS.ASSETS_VIEW`.
 *   3. Scoping:
 *      - Tenant isolation: strictly filtered by `workspaceId`.
 *      - TECHNICIAN role scoping (Phase 1.7.1 §11.2): A technician can view an asset if and only if
 *        assigned to an active WorkOrder (OPEN, ASSIGNED, IN_PROGRESS, ON_HOLD) that explicitly
 *        references this assetId or the asset's locationId.
 *   4. Cross-tenant / missing / unauthorized lookups throw `AssetNotFoundError` (HTTP 404)
 *      to prevent IDOR existence leakage.
 *   5. Single Prisma query with includes prevents N+1 lookups.
 *   6. Returns canonical `AssetDetailViewModel`.
 */
export async function getAsset(
    workspaceId: string,
    assetId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<AssetDetailViewModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));
    const role = authorization.membership.role;

    // --- 2. RBAC Permission Assertion ---
    assertPermission(role, PERMISSIONS.ASSETS_VIEW);

    // --- 3. Build Tenant-Scoped Where Filter ---
    const where: Prisma.AssetWhereInput = {
        id: assetId,
        workspaceId,
    };

    // --- 4. Role-Specific Scoping for TECHNICIAN (Phase 1.7.1 §11.2) ---
    if (role === "TECHNICIAN") {
        where.OR = [
            {
                workOrders: {
                    some: {
                        workspaceId,
                        assignedTechnician: {
                            employee: {
                                workspaceId,
                                workspaceMemberId: authorization.membership.id,
                            },
                        },
                        status: {
                            in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"],
                        },
                    },
                },
            },
            {
                locationId: { not: null },
                location: {
                    workOrders: {
                        some: {
                            workspaceId,
                            assignedTechnician: {
                                employee: {
                                    workspaceId,
                                    workspaceMemberId: authorization.membership.id,
                                },
                            },
                            status: {
                                in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"],
                            },
                        },
                    },
                },
            },
        ];
    }

    // --- 5. Single-Query Tenant-Scoped Lookup with Relations (No N+1) ---
    const asset = await prisma.asset.findFirst({
        where,
        include: {
            customer: true,
            location: true,
            category: true,
        },
    });

    if (!asset) {
        throw new AssetNotFoundError();
    }

    return toAssetDetailViewModel(asset);
}
