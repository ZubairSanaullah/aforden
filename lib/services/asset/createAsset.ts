import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createAssetSchema } from "./asset.schemas";
import {
    AssetCustomerNotFoundError,
    AssetCustomerInactiveError,
    AssetLocationNotFoundError,
    AssetLocationCustomerMismatchError,
    AssetLocationRequiresCustomerError,
    AssetCategoryNotFoundError,
    AssetCategoryInactiveError,
    DuplicateAssetNumberError,
} from "./assetErrors";
import type { AssetDetailViewModel } from "./asset.types";
import type { AssetStatus } from "@/generated/prisma/client";

const MAX_NUMBER_GENERATION_ATTEMPTS = 5;

/**
 * Creates a new physical Asset / Equipment within an authorized workspace.
 *
 * Locked Execution Order (Phase 1.7.1 & Phase 1.7.4):
 *   1. AUTHENTICATION: Verify active session & workspace membership via requireWorkspaceAuthorization().
 *   2. PERMISSION: Assert caller holds PERMISSIONS.ASSETS_CREATE.
 *   3. VALIDATION: Parse input payload through createAssetSchema from 1.7.3.
 *   4. RESOLUTION:
 *      - Customer check: If customerId provided, assert existence and ACTIVE status in workspace.
 *      - Location check: If locationId provided, assert existence in workspace.
 *      - Parity check: If both customerId and locationId provided, assert location.customerId === customerId.
 *      - Depot check: If customerId is null/omitted and locationId is provided, reject with mismatch error.
 *      - Category check: If categoryId provided, assert existence and ACTIVE status in workspace.
 *   5. BUSINESS RULES:
 *      - assetNumber: If explicit in input, verify workspace uniqueness; if omitted, atomically generate AST-XXXXXX.
 *      - status: If omitted, defaults to OPERATIONAL when customer/location are set, or IN_STORAGE for depot equipment.
 *   6. PERSISTENCE: Execute Asset insertion and AssetHistory CREATED event write inside a single atomic transaction.
 *   7. CANONICAL READ MODEL: Return created Asset shaped as AssetDetailViewModel.
 */
export async function createAsset(
    workspaceId: string,
    input: unknown,
): Promise<AssetDetailViewModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce ASSETS_CREATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.ASSETS_CREATE,
    );

    // --- 3. Validate Input Payload ---
    const data = createAssetSchema.parse(input);

    // --- 4. Relational Resolution & Invariant Verification ---
    let customer = null;
    if (data.customerId) {
        customer = await prisma.customer.findFirst({
            where: {
                id: data.customerId,
                workspaceId,
            },
        });

        if (!customer) {
            throw new AssetCustomerNotFoundError();
        }

        if (customer.status !== "ACTIVE") {
            throw new AssetCustomerInactiveError();
        }
    }

    let location = null;
    if (data.locationId) {
        // Depot rule check (Invariant 2): If customerId is null, locationId must also be null
        if (!data.customerId) {
            throw new AssetLocationRequiresCustomerError(
                "Service location cannot be assigned to an unassigned depot asset (customerId is null).",
            );
        }

        location = await prisma.serviceLocation.findFirst({
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

        // Ownership parity check (Invariant 1): location must belong to the customer
        if (location.customerId !== data.customerId) {
            throw new AssetLocationCustomerMismatchError();
        }
    }

    let category = null;
    if (data.categoryId) {
        category = await prisma.assetCategory.findFirst({
            where: {
                id: data.categoryId,
                workspaceId,
            },
        });

        if (!category) {
            throw new AssetCategoryNotFoundError();
        }

        if (category.status !== "ACTIVE") {
            throw new AssetCategoryInactiveError();
        }
    }

    // --- 5. Determine Operational Status Default ---
    // If raw input did not specify status:
    // - Customer + Location provided -> OPERATIONAL
    // - Depot inventory (no customer/location) -> IN_STORAGE
    const rawStatus = (input as Record<string, unknown> | null | undefined)?.status;
    let initialStatus: AssetStatus = data.status;
    if (rawStatus === undefined) {
        if (!data.customerId && !data.locationId) {
            initialStatus = "IN_STORAGE";
        } else {
            initialStatus = "OPERATIONAL";
        }
    }

    // --- 6. Concurrency-Safe Asset Number Generation & Atomic Persistence ---
    const isExplicitAssetNumber = Boolean(data.assetNumber);

    for (let attempt = 0; attempt < MAX_NUMBER_GENERATION_ATTEMPTS; attempt++) {
        try {
            const runTx = typeof prisma.$transaction === "function"
                ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
                : async (cb: (tx: any) => Promise<any>) => cb(prisma);

            const created = await runTx(async (tx) => {
                let assetNumberToUse = data.assetNumber;

                if (!assetNumberToUse) {
                    // Find highest current sequence matching AST-XXXXXX in workspace
                    const latest = await tx.asset.findFirst({
                        where: {
                            workspaceId,
                            assetNumber: {
                                startsWith: "AST-",
                            },
                        },
                        orderBy: {
                            assetNumber: "desc",
                        },
                        select: {
                            assetNumber: true,
                        },
                    });

                    let nextSeq = 1;
                    if (latest?.assetNumber) {
                        const match = latest.assetNumber.match(/^AST-(\d+)$/);
                        if (match && match[1]) {
                            const currentSeq = parseInt(match[1], 10);
                            if (!isNaN(currentSeq)) {
                                nextSeq = currentSeq + 1;
                            }
                        }
                    }

                    assetNumberToUse = `AST-${String(nextSeq).padStart(6, "0")}`;
                }

                // 6.1 Persist Asset Record
                const asset = await tx.asset.create({
                    data: {
                        workspaceId,
                        assetNumber: assetNumberToUse,
                        name: data.name,
                        customerId: data.customerId ?? null,
                        locationId: data.locationId ?? null,
                        categoryId: data.categoryId ?? null,

                        manufacturer: data.manufacturer ?? null,
                        modelNumber: data.modelNumber ?? null,
                        serialNumber: data.serialNumber ?? null,
                        status: initialStatus,

                        subLocationNotes: data.subLocationNotes ?? null,
                        installationDate: data.installationDate ?? null,
                        warrantyExpiresAt: data.warrantyExpiresAt ?? null,
                        purchaseDate: data.purchaseDate ?? null,
                        purchaseCost: data.purchaseCost !== undefined && data.purchaseCost !== null
                            ? String(data.purchaseCost)
                            : null,
                        notes: data.notes ?? null,
                        tags: data.tags ?? [],
                        metadata: data.metadata ?? undefined,

                        decommissionedAt: null,
                        retiredAt: null,
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

                // 6.2 Persist Immutable AssetHistory CREATED Event
                await tx.assetHistory.create({
                    data: {
                        workspaceId,
                        assetId: asset.id,
                        eventType: "CREATED",
                        actorUserId: authorization.user.id,
                        actorRole: authorization.membership.role,
                        reason: "Asset registered in workspace",
                        metadata: {
                            name: asset.name,
                            assetNumber: asset.assetNumber,
                            status: asset.status,
                            customerId: asset.customerId,
                            locationId: asset.locationId,
                            categoryId: asset.categoryId,
                            serialNumber: asset.serialNumber,
                            manufacturer: asset.manufacturer,
                        },
                    },
                });

                return asset;
            });

            // --- 7. Transform to Canonical AssetDetailViewModel ---
            return {
                id: created.id,
                workspaceId: created.workspaceId,
                assetNumber: created.assetNumber,
                name: created.name,
                status: created.status,

                manufacturer: created.manufacturer,
                modelNumber: created.modelNumber,
                serialNumber: created.serialNumber,
                subLocationNotes: created.subLocationNotes,

                installationDate: created.installationDate,
                warrantyExpiresAt: created.warrantyExpiresAt,
                purchaseDate: created.purchaseDate,
                purchaseCost: created.purchaseCost !== null ? Number(created.purchaseCost) : null,
                notes: created.notes,
                tags: created.tags,
                metadata: created.metadata as Record<string, any> | null,

                customer: created.customer
                    ? {
                          id: created.customer.id,
                          customerNumber: created.customer.customerNumber,
                          name: created.customer.name,
                      }
                    : null,

                location: created.location
                    ? {
                          id: created.location.id,
                          name: created.location.name,
                          addressLine1: created.location.addressLine1,
                          city: created.location.city,
                          state: created.location.state,
                          latitude: created.location.latitude,
                          longitude: created.location.longitude,
                      }
                    : null,

                category: created.category
                    ? {
                          id: created.category.id,
                          name: created.category.name,
                          code: created.category.code,
                      }
                    : null,

                createdAt: created.createdAt,
                updatedAt: created.updatedAt,
                decommissionedAt: created.decommissionedAt,
                retiredAt: created.retiredAt,
            };
        } catch (error: any) {
            const isUniqueCollision =
                error?.code === "P2002" ||
                (typeof error?.message === "string" &&
                    error.message.includes("Unique constraint failed"));

            if (isUniqueCollision) {
                // If client explicitly supplied a duplicate assetNumber, immediately fail with 409
                if (isExplicitAssetNumber) {
                    throw new DuplicateAssetNumberError();
                }

                // If auto-generated collision occurred due to a race condition, retry in next iteration
                if (attempt < MAX_NUMBER_GENERATION_ATTEMPTS - 1) {
                    continue;
                }
                throw new DuplicateAssetNumberError(
                    "Failed to auto-generate a unique asset number after multiple concurrent attempts.",
                );
            }

            throw error instanceof Error
                ? error
                : new Error("Failed to create asset record.");
        }
    }

    throw new Error("Failed to create asset after maximum retry attempts.");
}
