import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateAssetSchema } from "./asset.schemas";
import {
    AssetNotFoundError,
    AssetCategoryNotFoundError,
    AssetCategoryInactiveError,
    AssetImmutableError,
    AssetNumberLockedError,
    DuplicateAssetNumberError,
} from "./assetErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { AssetDetailViewModel } from "./asset.types";

/**
 * Updates mutable metadata, specifications, and notes for an existing Asset.
 *
 * Locked Execution Order (Phase 1.7.1 & Phase 1.7.5):
 *   1. AUTHENTICATION & RBAC: Enforce active workspace membership and PERMISSIONS.ASSETS_UPDATE.
 *   2. VALIDATION: Parse input through updateAssetSchema.
 *   3. RESOLUTION: Look up existing Asset by (id, workspaceId). 404 if missing.
 *   4. TECHNICIAN SCOPING: If caller is TECHNICIAN, assert assignment to active WorkOrder targeting this asset.
 *   5. BUSINESS RULES:
 *      - Immutability check: Reject updates if asset.status === "RETIRED".
 *      - Category validation: If categoryId changed, assert existence and ACTIVE status.
 *      - Asset number guard: If assetNumber changed, allow only for OWNER/ADMIN and block if historical WorkOrders exist.
 *      - Field Diff Calculation: Capture old vs new values for AssetHistory.
 *   6. PERSISTENCE: Single atomic transaction updating Asset and creating AssetHistory UPDATED event.
 *   7. CANONICAL READ MODEL: Return updated Asset shaped as AssetDetailViewModel.
 */
export async function updateAsset(
    workspaceId: string,
    assetId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<AssetDetailViewModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    assertPermission(
        authorization.membership.role,
        PERMISSIONS.ASSETS_UPDATE,
    );

    // --- 2. Validate Input Payload ---
    const data = updateAssetSchema.parse(input);

    // --- 3. Resolve Target Asset ---
    const existing = await prisma.asset.findFirst({
        where: {
            id: assetId,
            workspaceId,
        },
        include: {
            customer: true,
            location: true,
            category: true,
        },
    });

    if (!existing) {
        throw new AssetNotFoundError();
    }

    // --- 4. TECHNICIAN Scoping Rule (§11.2) ---
    if (authorization.membership.role === "TECHNICIAN") {
        const qualifyingWorkOrder = await prisma.workOrder.findFirst({
            where: {
                workspaceId,
                assignedTechnician: {
                    employee: {
                        workspaceMember: {
                            userId: authorization.user.id,
                        },
                    },
                },
                status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
                OR: [
                    { assetId: existing.id },
                    ...(existing.locationId ? [{ locationId: existing.locationId }] : []),
                ],
            },
        });

        if (!qualifyingWorkOrder) {
            throw new ForbiddenError(
                "Technicians may only update assets associated with an active work order assigned to them.",
            );
        }
    }

    // --- 5. Business Rules & Invariants ---
    // 5.1 Terminal State Immutability
    if (existing.status === "RETIRED") {
        throw new AssetImmutableError(
            "Asset is in a terminal state (RETIRED) and cannot be updated.",
        );
    }

    // 5.2 Category Validation (if categoryId is being modified)
    if (data.categoryId !== undefined && data.categoryId !== existing.categoryId) {
        if (data.categoryId !== null) {
            const newCategory = await prisma.assetCategory.findFirst({
                where: {
                    id: data.categoryId,
                    workspaceId,
                },
            });

            if (!newCategory) {
                throw new AssetCategoryNotFoundError();
            }

            if (newCategory.status !== "ACTIVE") {
                throw new AssetCategoryInactiveError();
            }
        }
    }

    // 5.3 Asset Number Modification Guard (§16)
    if (data.assetNumber !== undefined && data.assetNumber !== existing.assetNumber) {
        if (
            authorization.membership.role !== "OWNER" &&
            authorization.membership.role !== "ADMIN"
        ) {
            throw new ForbiddenError(
                "Only workspace owners and administrators are permitted to modify asset numbers.",
            );
        }

        const workOrderCount = await prisma.workOrder.count({
            where: {
                assetId: existing.id,
            },
        });

        if (workOrderCount > 0) {
            throw new AssetNumberLockedError(
                "Asset number is locked and cannot be modified once historical work orders exist.",
            );
        }
    }

    // 5.4 Compute Changed Field Diff for Audit Ledger
    const diff: Record<string, { oldValue: unknown; newValue: unknown }> = {};

    const trackDiff = (field: string, oldVal: unknown, newVal: unknown) => {
        if (newVal !== undefined && newVal !== oldVal) {
            diff[field] = {
                oldValue: oldVal ?? null,
                newValue: newVal ?? null,
            };
        }
    };

    trackDiff("name", existing.name, data.name);
    trackDiff("assetNumber", existing.assetNumber, data.assetNumber);
    trackDiff("categoryId", existing.categoryId, data.categoryId);
    trackDiff("manufacturer", existing.manufacturer, data.manufacturer);
    trackDiff("modelNumber", existing.modelNumber, data.modelNumber);
    trackDiff("serialNumber", existing.serialNumber, data.serialNumber);
    trackDiff("subLocationNotes", existing.subLocationNotes, data.subLocationNotes);
    trackDiff(
        "installationDate",
        existing.installationDate?.toISOString(),
        data.installationDate ? new Date(data.installationDate).toISOString() : data.installationDate
    );
    trackDiff(
        "warrantyExpiresAt",
        existing.warrantyExpiresAt?.toISOString(),
        data.warrantyExpiresAt ? new Date(data.warrantyExpiresAt).toISOString() : data.warrantyExpiresAt
    );
    trackDiff(
        "purchaseDate",
        existing.purchaseDate?.toISOString(),
        data.purchaseDate ? new Date(data.purchaseDate).toISOString() : data.purchaseDate
    );
    trackDiff(
        "purchaseCost",
        existing.purchaseCost ? String(existing.purchaseCost) : null,
        data.purchaseCost !== undefined && data.purchaseCost !== null ? String(data.purchaseCost) : data.purchaseCost
    );
    trackDiff("notes", existing.notes, data.notes);
    if (data.tags !== undefined) {
        const oldTags = JSON.stringify(existing.tags || []);
        const newTags = JSON.stringify(data.tags || []);
        if (oldTags !== newTags) {
            diff["tags"] = { oldValue: existing.tags, newValue: data.tags };
        }
    }
    if (data.metadata !== undefined) {
        const oldMeta = JSON.stringify(existing.metadata || null);
        const newMeta = JSON.stringify(data.metadata || null);
        if (oldMeta !== newMeta) {
            diff["metadata"] = { oldValue: existing.metadata, newValue: data.metadata };
        }
    }

    // --- 6. Atomic Persistence (Prisma Transaction) ---
    try {
        const runTx = typeof prisma.$transaction === "function"
            ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
            : async (cb: (tx: any) => Promise<any>) => cb(prisma);

        const updated = await runTx(async (tx) => {
            const asset = await tx.asset.update({
                where: {
                    id: existing.id,
                },
                data: {
                    name: data.name ?? undefined,
                    assetNumber: data.assetNumber ?? undefined,
                    categoryId: data.categoryId !== undefined ? data.categoryId : undefined,
                    manufacturer: data.manufacturer !== undefined ? data.manufacturer : undefined,
                    modelNumber: data.modelNumber !== undefined ? data.modelNumber : undefined,
                    serialNumber: data.serialNumber !== undefined ? data.serialNumber : undefined,
                    subLocationNotes: data.subLocationNotes !== undefined ? data.subLocationNotes : undefined,
                    installationDate: data.installationDate !== undefined ? data.installationDate : undefined,
                    warrantyExpiresAt: data.warrantyExpiresAt !== undefined ? data.warrantyExpiresAt : undefined,
                    purchaseDate: data.purchaseDate !== undefined ? data.purchaseDate : undefined,
                    purchaseCost: data.purchaseCost !== undefined
                        ? (data.purchaseCost !== null ? String(data.purchaseCost) : null)
                        : undefined,
                    notes: data.notes !== undefined ? data.notes : undefined,
                    tags: data.tags !== undefined ? data.tags : undefined,
                    metadata: data.metadata !== undefined ? (data.metadata ?? undefined) : undefined,
                },
                include: {
                    customer: {
                        select: {
                            id: true,
                            customerNumber: true,
                            name: true,
                        },
                    },
                    location: {
                        select: {
                            id: true,
                            name: true,
                            addressLine1: true,
                            city: true,
                            state: true,
                            latitude: true,
                            longitude: true,
                        },
                    },
                    category: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                        },
                    },
                },
            });

            // Write AssetHistory UPDATED event if changes occurred
            if (Object.keys(diff).length > 0) {
                await tx.assetHistory.create({
                    data: {
                        workspaceId,
                        assetId: asset.id,
                        eventType: "UPDATED",
                        actorUserId: authorization.user.id?.startsWith("api_app_") ? null : authorization.user.id,
                        actorRole: authorization.membership.role,
                        reason: "Asset properties updated",
                        metadata: { diff },
                    },
                });
            }

            return asset;
        });

        // --- 7. Project to Canonical AssetDetailViewModel ---
        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            assetNumber: updated.assetNumber,
            name: updated.name,
            status: updated.status,

            manufacturer: updated.manufacturer,
            modelNumber: updated.modelNumber,
            serialNumber: updated.serialNumber,
            subLocationNotes: updated.subLocationNotes,

            installationDate: updated.installationDate,
            warrantyExpiresAt: updated.warrantyExpiresAt,
            purchaseDate: updated.purchaseDate,
            purchaseCost: updated.purchaseCost !== null ? Number(updated.purchaseCost) : null,
            notes: updated.notes,
            tags: updated.tags,
            metadata: updated.metadata as Record<string, any> | null,

            customer: updated.customer
                ? {
                      id: updated.customer.id,
                      customerNumber: updated.customer.customerNumber,
                      name: updated.customer.name,
                  }
                : null,

            location: updated.location
                ? {
                      id: updated.location.id,
                      name: updated.location.name,
                      addressLine1: updated.location.addressLine1,
                      city: updated.location.city,
                      state: updated.location.state,
                      latitude: updated.location.latitude,
                      longitude: updated.location.longitude,
                  }
                : null,

            category: updated.category
                ? {
                      id: updated.category.id,
                      name: updated.category.name,
                      code: updated.category.code,
                  }
                : null,

            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
            decommissionedAt: updated.decommissionedAt,
            retiredAt: updated.retiredAt,
        };
    } catch (error: any) {
        if (
            error?.code === "P2002" ||
            (typeof error?.message === "string" &&
                error.message.includes("Unique constraint failed"))
        ) {
            throw new DuplicateAssetNumberError();
        }

        throw error instanceof Error ? error : new Error("Failed to update asset record.");
    }
}
