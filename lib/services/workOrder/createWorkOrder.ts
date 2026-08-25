import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createWorkOrderSchema } from "@/lib/validations/workOrder";
import { getWorkTypeForWorkOrderConsumption } from "@/lib/services/workType/getWorkTypeForWorkOrderConsumption";
import {
    WorkOrderCustomerNotFoundError,
    WorkOrderCustomerInactiveError,
    WorkOrderLocationNotFoundError,
    WorkOrderAssetCustomerMismatchError,
    WorkOrderAssetLocationMismatchError,
    DuplicateWorkOrderReferenceError,
} from "./workOrderErrors";
import {
    AssetNotFoundError,
    AssetImmutableError,
} from "@/lib/services/asset/assetErrors";
import type { WorkOrderReadModel } from "./workOrder.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

const MAX_NUMBER_GENERATION_ATTEMPTS = 3;

/**
 * Creates a new WorkOrder within an authorized workspace.
 *
 * Implementation sequence & security invariants (Phase 1.6.1, 1.6.4, & 1.7.7):
 *   1. Authenticate session & verify active membership in target workspace (`requireWorkspaceAuthorization`).
 *   2. Enforce RBAC permission `WORK_ORDERS_CREATE` (`assertPermission`).
 *   3. Validate input payload against Zod schema (`createWorkOrderSchema.parse`).
 *   4. Tenant-check & resolve Customer (`findFirst({ where: { id, workspaceId } })`):
 *      - Not found -> `WorkOrderCustomerNotFoundError` (404).
 *      - Inactive -> `WorkOrderCustomerInactiveError` (400).
 *   5. Tenant & customer parity check for ServiceLocation (`findFirst({ where: { id, customerId } })`):
 *      - Not found or mismatch -> `WorkOrderLocationNotFoundError` (404).
 *   6. Consume WorkType via `getWorkTypeForWorkOrderConsumption(workspaceId, workTypeId)`:
 *      - Propagate `WorkTypeNotFoundError` and `WorkTypeUnavailableForWorkOrderError` as-is.
 *   6.5. Optional Asset Resolution & Customer/Location Consistency Checks (Phase 1.7.7 §9.2 & §17.3):
 *      - If assetId provided -> lookup Asset in target workspace (404 AssetNotFoundError if missing).
 *      - Reject RETIRED assets with AssetImmutableError (409).
 *      - If Asset has customerId (customer-owned), assert customerId === data.customerId (422 WorkOrderAssetCustomerMismatchError).
 *      - If Asset has locationId, assert locationId === data.locationId (422 WorkOrderAssetLocationMismatchError).
 *      - If Asset is a depot asset (customerId === null), skip customer/location checks (depot deployment).
 *   7. Skip technician resolution (WorkOrders are created OPEN and unassigned).
 *   8. Atomically generate sequential `workOrderNumber` (`WO-YYYY-XXXXXX`) inside database transaction.
 *   9. Persist `WorkOrder` with immutable snapshot fields, assetId, and explicit status `"OPEN"`.
 *   10. Return operational `WorkOrderReadModel`.
 */
export async function createWorkOrder(
    workspaceId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
    txClient?: Prisma.TransactionClient,
): Promise<WorkOrderReadModel> {
    const db = txClient ?? prisma;

    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // --- 2. RBAC: Enforce WORK_ORDERS_CREATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.WORK_ORDERS_CREATE,
    );

    // --- 3. Validate Input Payload ---
    const data = createWorkOrderSchema.parse(input);

    // --- 4. Tenant-Scoped Customer Resolution & Lifecycle Check ---
    const customer = await db.customer.findFirst({
        where: {
            id: data.customerId,
            workspaceId,
        },
    });

    if (!customer) {
        throw new WorkOrderCustomerNotFoundError();
    }

    if (customer.status !== "ACTIVE") {
        throw new WorkOrderCustomerInactiveError();
    }

    // --- 5. Relational Parity & ServiceLocation Resolution ---
    const location = await db.serviceLocation.findFirst({
        where: {
            id: data.locationId,
            customerId: data.customerId,
        },
    });

    if (!location) {
        throw new WorkOrderLocationNotFoundError();
    }

    // --- 6. Consume WorkType Template & Verify Active Operational Availability ---
    const workTypeSnapshot = await getWorkTypeForWorkOrderConsumption(
        workspaceId,
        data.workTypeId,
    );

    // --- 6.5. Optional Asset Resolution & Consistency Checks (§9.2 & §17.3) ---
    if (data.assetId) {
        const asset = await db.asset.findFirst({
            where: {
                id: data.assetId,
                workspaceId,
            },
        });

        if (!asset) {
            throw new AssetNotFoundError();
        }

        // Section 17.3: Retired assets are permanently blocked from new WorkOrders
        if (asset.status === "RETIRED") {
            throw new AssetImmutableError(
                "Cannot associate a work order with a retired asset.",
            );
        }

        // Section 9.2: Customer / Location Consistency Invariants
        // If the Asset is a depot asset (customerId === null), skip customer/location checks (depot deployment)
        if (asset.customerId !== null) {
            if (asset.customerId !== data.customerId) {
                throw new WorkOrderAssetCustomerMismatchError();
            }

            if (asset.locationId !== null && asset.locationId !== data.locationId) {
                throw new WorkOrderAssetLocationMismatchError();
            }
        }
    }

    // --- 7 & 8 & 9. Atomic Number Generation & WorkOrder Insertion in Transaction ---
    const currentYear = new Date().getFullYear();
    const prefix = `WO-${currentYear}-`;

    for (let attempt = 0; attempt < MAX_NUMBER_GENERATION_ATTEMPTS; attempt++) {
        try {
            const runTx = txClient
                ? async (cb: (tx: any) => Promise<any>) => cb(txClient)
                : (typeof prisma.$transaction === "function"
                    ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
                    : async (cb: (tx: any) => Promise<any>) => cb(prisma));

            const created = await runTx(async (tx) => {
                // Compute next sequential reference number inside the transaction
                const latest = await tx.workOrder.findFirst({
                    where: {
                        workspaceId,
                        workOrderNumber: {
                            startsWith: prefix,
                        },
                    },
                    orderBy: {
                        workOrderNumber: "desc",
                    },
                    select: {
                        workOrderNumber: true,
                    },
                });

                let nextSeq = 1;
                if (latest?.workOrderNumber) {
                    const match = latest.workOrderNumber.match(/^WO-\d{4}-(\d+)$/);
                    if (match && match[1]) {
                        const currentSeq = parseInt(match[1], 10);
                        if (!isNaN(currentSeq)) {
                            nextSeq = currentSeq + 1;
                        }
                    }
                }

                const workOrderNumber = `${prefix}${String(nextSeq).padStart(6, "0")}`;

                const wo = await tx.workOrder.create({
                    data: {
                        workspaceId,
                        workOrderNumber,
                        customerId: data.customerId,
                        locationId: data.locationId,
                        workTypeId: data.workTypeId,
                        assignedTechnicianId: null,
                        assetId: data.assetId ?? null,

                        // Snapshot values strictly copied from WorkType template
                        workTypeName: workTypeSnapshot.name,
                        workTypeCode: workTypeSnapshot.code ?? null,
                        estimatedDuration: workTypeSnapshot.estimatedDuration ?? null,

                        status: "OPEN",
                        priority: data.priority ?? "MEDIUM",

                        title: data.title,
                        description: data.description ?? null,
                        internalNotes: data.internalNotes ?? null,
                        holdReason: null,
                        cancellationReason: null,
                        startedAt: null,
                        completedAt: null,
                        cancelledAt: null,
                    },
                    include: {
                        customer: true,
                        location: true,
                        workType: true,
                    },
                });

                if (tx.workOrderHistory?.create) {
                    await tx.workOrderHistory.create({
                        data: {
                            workspaceId,
                            workOrderId: wo.id,
                            eventType: "CREATED",
                            actorMemberId: authorization.membership.id,
                            actorName: authorization.user.name || authorization.user.email,
                            newValue: wo.workOrderNumber,
                            metadata: JSON.stringify({
                                title: wo.title,
                                priority: wo.priority,
                                status: wo.status,
                                customerId: wo.customerId,
                                locationId: wo.locationId,
                                workTypeId: wo.workTypeId,
                                assetId: wo.assetId,
                            }),
                        },
                    });
                }

                // Phase 1.13.9: Emit WORK_ORDER_CREATED event in same transaction
                await emitNotificationEvent(tx, {
                    workspaceId,
                    eventType: NotificationEventType.WORK_ORDER_CREATED,
                    sourceEntity: "WorkOrder",
                    sourceId: wo.id,
                    actorMemberId: authorization.membership.id,
                    payload: {
                        workOrderId: wo.id,
                        workOrderNumber: wo.workOrderNumber,
                        title: wo.title,
                        customerId: wo.customerId,
                        customerName: customer.name,
                        priority: wo.priority,
                    },
                });

                return wo;
            });

            const locationAddress = [
                created.location.addressLine1,
                created.location.addressLine2,
                created.location.city,
                created.location.state,
                created.location.postalCode,
                created.location.country,
            ]
                .filter(Boolean)
                .join(", ");

            return {
                id: created.id,
                workspaceId: created.workspaceId,
                workOrderNumber: created.workOrderNumber,

                customerId: created.customerId,
                customerName: created.customer.name,
                customerNumber: created.customer.customerNumber,

                locationId: created.locationId,
                locationName: created.location.name,
                locationAddress,

                workTypeId: created.workTypeId,
                workTypeName: created.workTypeName,
                workTypeCode: created.workTypeCode,
                estimatedDuration: created.estimatedDuration,

                assignedTechnicianId: created.assignedTechnicianId,
                assetId: created.assetId ?? null,

                status: created.status,
                priority: created.priority,

                title: created.title,
                description: created.description,
                internalNotes: created.internalNotes,
                holdReason: created.holdReason,
                cancellationReason: created.cancellationReason,

                startedAt: created.startedAt,
                completedAt: created.completedAt,
                cancelledAt: created.cancelledAt,

                createdAt: created.createdAt,
                updatedAt: created.updatedAt,
            };
        } catch (error: any) {
            const isUniqueCollision =
                error?.code === "P2002" ||
                (typeof error?.message === "string" &&
                    error.message.includes("Unique constraint failed"));

            if (isUniqueCollision) {
                if (attempt < MAX_NUMBER_GENERATION_ATTEMPTS - 1) {
                    continue;
                }
                throw new DuplicateWorkOrderReferenceError();
            }

            throw error instanceof Error
                ? error
                : new Error("Failed to create work order record.");
        }
    }

    throw new Error("Failed to generate a unique work order number after maximum retry attempts.");
}
