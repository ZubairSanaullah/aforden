import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { transitionAssetStatusSchema } from "./asset.schemas";
import {
    getStatusTransitionRule,
    isStatusTransitionAllowed,
} from "./assetStatusTransitions";
import {
    AssetNotFoundError,
    AssetInvalidStatusTransitionError,
    AssetMissingStatusReasonError,
    AssetImmutableError,
} from "./assetErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { AssetDetailViewModel } from "./asset.types";
import type { AssetHistoryEventType } from "@/generated/prisma/client";

/**
 * Transitions the operational lifecycle status of an Asset per Phase 1.7.1 Section 2.2.
 *
 * Locked Execution Order:
 *   1. AUTHENTICATION & RESOLUTION: Verify workspace membership and fetch target Asset.
 *   2. IMMUTABILITY CHECK: Reject if current asset is RETIRED (terminal state).
 *   3. TRANSITION & RBAC VALIDATION: Validate (fromStatus, toStatus) tuple against state machine and verify caller role.
 *   4. TECHNICIAN SCOPING: If caller is TECHNICIAN, verify assignment to qualifying active WorkOrder.
 *   5. STATUS REASON ENFORCEMENT: Assert non-empty reason if required for this specific transition pair.
 *   6. SIDE EFFECTS:
 *      - -> IN_STORAGE: set locationId = null (uninstalled to depot).
 *      - -> DECOMMISSIONED: set decommissionedAt = now().
 *      - DECOMMISSIONED ->: clear decommissionedAt = null (reactivated).
 *      - -> RETIRED: set retiredAt = now().
 *   7. EVENT TYPE RESOLUTION: Map to RETIRED, DECOMMISSIONED, REACTIVATED, or STATUS_CHANGED.
 *   8. ATOMIC PERSISTENCE: Execute status update and AssetHistory audit write in a single transaction.
 *   9. CANONICAL READ MODEL: Return updated Asset shaped as AssetDetailViewModel.
 */
export async function transitionAssetStatus(
    workspaceId: string,
    assetId: string,
    input: unknown,
): Promise<AssetDetailViewModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. Resolve Target Asset ---
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

    // --- 3. Terminal State Check ---
    if (existing.status === "RETIRED") {
        throw new AssetImmutableError(
            "Asset is in a terminal state (RETIRED) and cannot undergo status transitions.",
        );
    }

    // --- 4. Validate Input Payload ---
    let data: z.infer<typeof transitionAssetStatusSchema>;
    try {
        data = transitionAssetStatusSchema.parse(input);
    } catch (err: any) {
        if (err?.name === "ZodError" && Array.isArray(err?.issues) && err.issues.some((i: any) => i.path.includes("statusReason"))) {
            throw new AssetMissingStatusReasonError();
        }
        throw err;
    }

    // If no change in status, return current read model
    if (existing.status === data.toStatus) {
        return projectAssetToViewModel(existing);
    }

    // --- 5. State Transition Machine & Role Enforcement ---
    const rule = getStatusTransitionRule(existing.status, data.toStatus);
    if (!rule) {
        throw new AssetInvalidStatusTransitionError(
            `Status transition from ${existing.status} to ${data.toStatus} is not permitted by the lifecycle state machine.`,
        );
    }

    if (!rule.allowedRoles.includes(authorization.membership.role)) {
        throw new ForbiddenError(
            `Role ${authorization.membership.role} is not authorized to transition status from ${existing.status} to ${data.toStatus}.`,
        );
    }

    // --- 6. TECHNICIAN Scoping Rule (§11.2) ---
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
                "Technicians may only transition status for assets associated with an active work order assigned to them.",
            );
        }
    }

    // --- 7. Validate Status Reason Requirement ---
    const hasReason =
        data.statusReason !== undefined &&
        data.statusReason !== null &&
        data.statusReason.trim().length > 0;

    if (rule.requiresReason && !hasReason) {
        throw new AssetMissingStatusReasonError(
            `Status reason is required when transitioning status from ${existing.status} to ${data.toStatus}.`,
        );
    }

    // --- 8. Determine Transition Side Effects & Audit Event Type ---
    let newLocationId = existing.locationId;
    let newDecommissionedAt = existing.decommissionedAt;
    let newRetiredAt = existing.retiredAt;
    let eventType: AssetHistoryEventType = "STATUS_CHANGED";

    // Side Effect A: Move to IN_STORAGE uninstalls equipment from site (locationId = null)
    if (
        data.toStatus === "IN_STORAGE" &&
        ["OPERATIONAL", "DEGRADED", "OUT_OF_SERVICE"].includes(existing.status)
    ) {
        newLocationId = null;
    }

    // Side Effect B: Decommissioning
    if (data.toStatus === "DECOMMISSIONED") {
        newDecommissionedAt = new Date();
        eventType = "DECOMMISSIONED";
    }

    // Side Effect C: Reactivation from Decommissioned
    if (
        existing.status === "DECOMMISSIONED" &&
        ["IN_STORAGE", "OPERATIONAL"].includes(data.toStatus)
    ) {
        newDecommissionedAt = null;
        eventType = "REACTIVATED";
    }

    // Side Effect D: Retirement
    if (data.toStatus === "RETIRED") {
        newRetiredAt = new Date();
        eventType = "RETIRED";
    }

    // --- 9. Atomic Persistence (Prisma Transaction) ---
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        const asset = await tx.asset.update({
            where: {
                id: existing.id,
            },
            data: {
                status: data.toStatus,
                locationId: newLocationId,
                decommissionedAt: newDecommissionedAt,
                retiredAt: newRetiredAt,
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

        // Record Audit History Entry
        await tx.assetHistory.create({
            data: {
                workspaceId,
                assetId: asset.id,
                eventType,
                actorUserId: authorization.user.id,
                actorRole: authorization.membership.role,
                reason: data.statusReason ?? null,
                metadata: {
                    fromStatus: existing.status,
                    toStatus: data.toStatus,
                    statusReason: data.statusReason ?? null,
                    locationUninstalled: existing.locationId !== newLocationId,
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
