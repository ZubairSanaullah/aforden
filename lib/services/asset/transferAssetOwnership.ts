import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { transferAssetOwnershipSchema } from "./asset.schemas";
import {
    AssetNotFoundError,
    AssetCustomerNotFoundError,
    AssetCustomerInactiveError,
    AssetLocationNotFoundError,
    AssetLocationCustomerMismatchError,
    AssetImmutableError,
    AssetDecommissionedTransferError,
} from "./assetErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { AssetDetailViewModel } from "./asset.types";

/**
 * Transfers ownership of an Asset to a different Customer and optionally assigns a new location (Phase 1.7.1 §4.2).
 *
 * Locked Execution Order:
 *   1. AUTHENTICATION & RBAC: Enforce workspace authorization and PERMISSIONS.ASSETS_TRANSFER.
 *      Hard-reject TECHNICIAN callers.
 *   2. VALIDATION: Parse input through transferAssetOwnershipSchema.
 *   3. RESOLUTION: Look up existing Asset by (id, workspaceId). 404 if missing.
 *   4. MOVEABLE STATE INVARIANTS:
 *      - Reject RETIRED assets with AssetImmutableError (409).
 *      - Reject DECOMMISSIONED assets with AssetDecommissionedTransferError (409).
 *   5. TARGET CUSTOMER RESOLUTION: Assert existence and ACTIVE status (404/400).
 *   6. TARGET LOCATION RESOLUTION:
 *      - If locationId provided: lookup and assert customer ownership parity (404/422).
 *      - If locationId omitted: clear locationId = null.
 *   7. HISTORICAL WORK ORDER INTEGRITY (Snapshot Rule, §4.2):
 *      - Existing historical WorkOrder records remain strictly bound to their historical customerId and locationId.
 *      - No cascades or modifications are performed against WorkOrder records.
 *   8. ATOMIC PERSISTENCE: Single transaction updating Asset customer/location and writing OWNERSHIP_TRANSFERRED history.
 *   9. CANONICAL READ MODEL: Return updated Asset formatted as AssetDetailViewModel.
 */
export async function transferAssetOwnership(
    workspaceId: string,
    assetId: string,
    input: unknown,
): Promise<AssetDetailViewModel> {
    // --- 1. Authenticate & Authorize Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    assertPermission(
        authorization.membership.role,
        PERMISSIONS.ASSETS_TRANSFER,
    );

    if (authorization.membership.role === "TECHNICIAN") {
        throw new ForbiddenError(
            "Technicians are not authorized to transfer asset ownership.",
        );
    }

    // --- 2. Validate Payload ---
    const data = transferAssetOwnershipSchema.parse(input);

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

    // --- 4. Moveable State Invariants (§4.2 Validation Rule 3) ---
    if (existing.status === "RETIRED") {
        throw new AssetImmutableError(
            "Asset is in a terminal state (RETIRED) and cannot be transferred.",
        );
    }

    if (existing.status === "DECOMMISSIONED") {
        throw new AssetDecommissionedTransferError(
            "Decommissioned equipment cannot be transferred to a new owner without first being reactivated.",
        );
    }

    // --- 5. Resolve Target Customer (§4.2 Validation Rule 1 & Invariant 3) ---
    const targetCustomer = await prisma.customer.findFirst({
        where: {
            id: data.customerId,
            workspaceId,
        },
    });

    if (!targetCustomer) {
        throw new AssetCustomerNotFoundError();
    }

    if (targetCustomer.status !== "ACTIVE") {
        throw new AssetCustomerInactiveError();
    }

    // --- 6. Resolve Target ServiceLocation (§4.2 Validation Rule 2) ---
    let destinationLocationId: string | null = null;
    if (data.locationId) {
        const location = await prisma.serviceLocation.findFirst({
            where: {
                id: data.locationId,
                customer: {
                    workspaceId,
                },
            },
        });

        if (!location) {
            throw new AssetLocationNotFoundError();
        }

        if (location.customerId !== targetCustomer.id) {
            throw new AssetLocationCustomerMismatchError(
                "Specified service location does not belong to the target customer.",
            );
        }

        destinationLocationId = location.id;
    }

    const fromCustomerId = existing.customerId;
    const fromLocationId = existing.locationId;
    const fromSubLocationNotes = existing.subLocationNotes;

    // --- 7. Atomic Persistence (Prisma Transaction) ---
    // Note: The Snapshot Rule (§4.2) requires historical WorkOrder rows to remain completely untouched.
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        const asset = await tx.asset.update({
            where: {
                id: existing.id,
            },
            data: {
                customerId: targetCustomer.id,
                locationId: destinationLocationId,
                subLocationNotes:
                    data.subLocationNotes !== undefined
                        ? data.subLocationNotes
                        : null,
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

        // Record OWNERSHIP_TRANSFERRED Audit Event with all 4 coordinates
        await tx.assetHistory.create({
            data: {
                workspaceId,
                assetId: asset.id,
                eventType: "OWNERSHIP_TRANSFERRED",
                actorUserId: authorization.user.id,
                actorRole: authorization.membership.role,
                reason: data.transferReason,
                metadata: {
                    fromCustomerId,
                    toCustomerId: targetCustomer.id,
                    fromLocationId,
                    toLocationId: destinationLocationId,
                    fromSubLocationNotes,
                    toSubLocationNotes: data.subLocationNotes ?? null,
                },
            },
        });

        return asset;
    });

    return projectAssetToViewModel(updated);
}

function projectAssetToViewModel(asset: any): AssetDetailViewModel {
    return {
        id: asset.id,
        workspaceId: asset.workspaceId,
        assetNumber: asset.assetNumber,
        name: asset.name,
        status: asset.status,

        manufacturer: asset.manufacturer,
        modelNumber: asset.modelNumber,
        serialNumber: asset.serialNumber,
        subLocationNotes: asset.subLocationNotes,

        installationDate: asset.installationDate,
        warrantyExpiresAt: asset.warrantyExpiresAt,
        purchaseDate: asset.purchaseDate,
        purchaseCost: asset.purchaseCost !== null ? Number(asset.purchaseCost) : null,
        notes: asset.notes,
        tags: asset.tags,
        metadata: asset.metadata as Record<string, any> | null,

        customer: asset.customer
            ? {
                  id: asset.customer.id,
                  customerNumber: asset.customer.customerNumber,
                  name: asset.customer.name,
              }
            : null,

        location: asset.location
            ? {
                  id: asset.location.id,
                  name: asset.location.name,
                  addressLine1: asset.location.addressLine1,
                  city: asset.location.city,
                  state: asset.location.state,
                  latitude: asset.location.latitude,
                  longitude: asset.location.longitude,
              }
            : null,

        category: asset.category
            ? {
                  id: asset.category.id,
                  name: asset.category.name,
                  code: asset.category.code,
              }
            : null,

        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
        decommissionedAt: asset.decommissionedAt,
        retiredAt: asset.retiredAt,
    };
}
