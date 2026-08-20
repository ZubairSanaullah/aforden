import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { transferAssetLocationSchema } from "./asset.schemas";
import {
    AssetNotFoundError,
    AssetLocationNotFoundError,
    AssetLocationCustomerMismatchError,
    AssetLocationRequiresCustomerError,
    AssetImmutableError,
    AssetDecommissionedTransferError,
} from "./assetErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { AssetDetailViewModel } from "./asset.types";

/**
 * Transfers an Asset to a different ServiceLocation under the SAME customer (Phase 1.7.1 §4.1).
 *
 * Locked Execution Order:
 *   1. AUTHENTICATION & RBAC: Verify workspace authorization and PERMISSIONS.ASSETS_TRANSFER.
 *      Hard-reject TECHNICIAN callers (no scoping exception for transfers).
 *   2. VALIDATION: Parse input via transferAssetLocationSchema.
 *   3. RESOLUTION: Look up existing Asset by (id, workspaceId). 404 if missing.
 *   4. MOVEABLE STATE INVARIANTS:
 *      - Reject RETIRED assets with AssetImmutableError (409).
 *      - Reject DECOMMISSIONED assets with AssetDecommissionedTransferError (409).
 *      - Depot Rule: Reject unassigned depot assets (customerId === null) with AssetLocationRequiresCustomerError (422).
 *   5. DESTINATION RESOLUTION: Lookup destination location; assert customerId match (422 if mismatch).
 *   6. NO-OP CHECK: If destination location and subLocationNotes are unchanged, return current state without write.
 *   7. ATOMIC PERSISTENCE: Single transaction updating Asset location and writing LOCATION_TRANSFERRED history.
 *   8. CANONICAL READ MODEL: Return updated Asset formatted as AssetDetailViewModel.
 */
export async function transferAssetLocation(
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
            "Technicians are not authorized to transfer asset locations.",
        );
    }

    // --- 2. Validate Payload ---
    const data = transferAssetLocationSchema.parse(input);

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

    // --- 4. Moveable State Invariants (§4.1 Validation Rule 2) ---
    if (existing.status === "RETIRED") {
        throw new AssetImmutableError(
            "Asset is in a terminal state (RETIRED) and cannot be transferred.",
        );
    }

    if (existing.status === "DECOMMISSIONED") {
        throw new AssetDecommissionedTransferError(
            "Decommissioned equipment cannot be transferred to a new location without first being reactivated.",
        );
    }

    if (existing.customerId === null) {
        throw new AssetLocationRequiresCustomerError(
            "Unassigned depot equipment cannot be moved to a service location without first being assigned to a customer via ownership transfer.",
        );
    }

    // --- 5. Resolve Destination ServiceLocation (§4.1 Validation Rule 1) ---
    const destination = await prisma.serviceLocation.findFirst({
        where: {
            id: data.locationId,
            customer: {
                workspaceId,
            },
        },
    });

    if (!destination) {
        throw new AssetLocationNotFoundError();
    }

    if (destination.customerId !== existing.customerId) {
        throw new AssetLocationCustomerMismatchError(
            "Destination service location belongs to a different customer. Use transferAssetOwnership() to transfer equipment across customers.",
        );
    }

    // --- 6. No-Op Guard ---
    if (
        destination.id === existing.locationId &&
        (data.subLocationNotes === undefined || data.subLocationNotes === existing.subLocationNotes)
    ) {
        return projectAssetToViewModel(existing);
    }

    const fromLocationId = existing.locationId;
    const fromSubLocationNotes = existing.subLocationNotes;

    // --- 7. Atomic Persistence (Prisma Transaction) ---
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        const asset = await tx.asset.update({
            where: {
                id: existing.id,
            },
            data: {
                locationId: destination.id,
                subLocationNotes:
                    data.subLocationNotes !== undefined
                        ? data.subLocationNotes
                        : undefined,
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

        // Record LOCATION_TRANSFERRED Audit Event
        await tx.assetHistory.create({
            data: {
                workspaceId,
                assetId: asset.id,
                eventType: "LOCATION_TRANSFERRED",
                actorUserId: authorization.user.id,
                actorRole: authorization.membership.role,
                reason: data.transferReason,
                metadata: {
                    fromLocationId,
                    toLocationId: destination.id,
                    fromSubLocationNotes,
                    toSubLocationNotes: data.subLocationNotes ?? fromSubLocationNotes,
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
