import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { statusTransitionSchema } from "@/lib/validations/workOrder";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
    WorkOrderAssignmentNotAllowedError,
    WorkOrderCompletionPreconditionFailedError,
} from "./workOrderErrors";
import type { WorkOrderReadModel } from "./workOrder.types";
import type { WorkOrderStatus } from "@/generated/prisma/client";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

/**
 * Validates whether a (fromStatus, toStatus) pair exists in the locked
 * lifecycle transition matrix (Phase 1.6.1 §4.2).
 */
function isMatrixTransitionAllowed(
    from: WorkOrderStatus,
    to: WorkOrderStatus,
): boolean {
    if (from === "OPEN") {
        return to === "ASSIGNED" || to === "CANCELLED";
    }
    if (from === "ASSIGNED") {
        return (
            to === "OPEN" ||
            to === "IN_PROGRESS" ||
            to === "ON_HOLD" ||
            to === "CANCELLED"
        );
    }
    if (from === "IN_PROGRESS") {
        return (
            to === "COMPLETED" ||
            to === "ON_HOLD" ||
            to === "CANCELLED"
        );
    }
    if (from === "ON_HOLD") {
        return (
            to === "IN_PROGRESS" ||
            to === "ASSIGNED" ||
            to === "CANCELLED"
        );
    }
    // Terminal states (COMPLETED, CANCELLED) have zero valid outgoing transitions
    return false;
}

/**
 * Transitions the lifecycle status of an existing WorkOrder within an authorized workspace.
 *
 * Implementation sequence & security invariants (Phase 1.6.1 & Phase 1.6.5):
 *   1. Authenticate session & verify active membership in target workspace (`requireWorkspaceAuthorization`).
 *   2. Reject roles with zero operational transition authority (`ACCOUNTANT`).
 *   3. Scoped tenant lookup for target WorkOrder (`findFirst({ where: { id, workspaceId } })`):
 *      - Not found -> `WorkOrderNotFoundError` (404, IDOR protection).
 *   4. Validate input payload shape via `statusTransitionSchema` (superRefine enforces reasons).
 *   5. Terminal state guard: `COMPLETED` and `CANCELLED` cannot transition to any status (409).
 *   6. Matrix legality validation: verify (fromStatus, toStatus) is in the 1.6.1 §4.2 state machine (409).
 *   7. Role-specific authorization:
 *      - OWNER, ADMIN, MANAGER: Full matrix authority.
 *      - DISPATCHER: Excluded from IN_PROGRESS -> COMPLETED (403).
 *      - TECHNICIAN: Must be assigned worker (assignedTechnicianId === technicianProfile.id)
 *        AND restricted strictly to: IN_PROGRESS->ON_HOLD, ON_HOLD->IN_PROGRESS, IN_PROGRESS->COMPLETED (403).
 *   8. Precondition verification:
 *      - IN_PROGRESS -> COMPLETED: requires `assignedTechnicianId !== null` (422).
 *   9. Calculate side effects (timestamps, reasons, unassign reset, hold clear).
 *   10. Persist single-row update via `prisma.workOrder.update` and return `WorkOrderReadModel`.
 */
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

export async function transitionWorkOrderStatus(
    workspaceId: string,
    workOrderId: string,
    input: unknown,
    actorOrTx?: WorkspaceAuthorizationContext | any,
    txClient?: any,
): Promise<WorkOrderReadModel & { _historyRecordId?: string }> {
    let actor: WorkspaceAuthorizationContext | undefined;
    let db: any = prisma;

    if (actorOrTx && typeof actorOrTx === "object" && "membership" in actorOrTx) {
        actor = actorOrTx;
        db = txClient ?? prisma;
    } else if (actorOrTx) {
        db = actorOrTx;
    }

    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));
    const role = authorization.membership.role;

    // --- 2. Immediate Role Guard (Read-only / Audit roles) ---
    if (role === "ACCOUNTANT") {
        throw new ForbiddenError(
            "Accountants are not authorized to transition work order status.",
        );
    }

    // --- 3. Tenant-Scoped WorkOrder Lookup ---
    const workOrder = await db.workOrder.findFirst({
        where: {
            id: workOrderId,
            workspaceId,
        },
        include: {
            customer: true,
            location: true,
            workType: true,
        },
    });

    if (!workOrder) {
        throw new WorkOrderNotFoundError();
    }

    // --- 4. Validate Input Payload Shape & Conditional Reasons ---
    const data = statusTransitionSchema.parse(input);
    const fromStatus = workOrder.status;
    const toStatus = data.toStatus;

    // --- 5. Terminal State Guard & No-Op Guard ---
    if (
        fromStatus === "COMPLETED" ||
        fromStatus === "CANCELLED" ||
        fromStatus === toStatus
    ) {
        throw new WorkOrderInvalidStatusTransitionError();
    }

    // --- 6. Matrix Legality Validation (Is (from, to) legal at all?) ---
    if (!isMatrixTransitionAllowed(fromStatus, toStatus)) {
        throw new WorkOrderInvalidStatusTransitionError();
    }

    // --- 7. Role-Specific Transition Authorization ---
    if (role === "TECHNICIAN") {
        // Resolve caller's TechnicianProfile in this workspace
        const callerProfile = await db.technicianProfile.findFirst({
            where: {
                employee: {
                    workspaceId,
                    workspaceMemberId: authorization.membership.id,
                },
            },
            select: {
                id: true,
            },
        });

        // Technician must have an active profile AND be the assigned technician on this WorkOrder
        if (
            !callerProfile ||
            !workOrder.assignedTechnicianId ||
            workOrder.assignedTechnicianId !== callerProfile.id
        ) {
            throw new ForbiddenError(
                "Technicians can only transition work orders assigned to them.",
            );
        }

        // Permitted Technician Transitions (Phase 1.9 §11.1):
        // 1. ASSIGNED -> IN_PROGRESS (Starting assigned work)
        // 2. IN_PROGRESS -> ON_HOLD (Placing work on hold)
        // 3. ON_HOLD -> IN_PROGRESS (Resuming work)
        // 4. IN_PROGRESS -> COMPLETED (Completing work)
        const isPermittedTechnicianTransition =
            (fromStatus === "ASSIGNED" && toStatus === "IN_PROGRESS") ||
            (fromStatus === "IN_PROGRESS" && toStatus === "ON_HOLD") ||
            (fromStatus === "ON_HOLD" && toStatus === "IN_PROGRESS") ||
            (fromStatus === "IN_PROGRESS" && toStatus === "COMPLETED");

        if (!isPermittedTechnicianTransition) {
            throw new ForbiddenError(
                "Technicians are not authorized to perform this status transition.",
            );
        }
    } else if (role === "DISPATCHER") {
        // Dispatchers are excluded from completing work orders
        if (fromStatus === "IN_PROGRESS" && toStatus === "COMPLETED") {
            throw new ForbiddenError(
                "Dispatchers are not authorized to complete work orders.",
            );
        }
    }
    // OWNER, ADMIN, MANAGER proceed with full matrix authority

    // --- 8. Enforce Transition Preconditions ---
    if (toStatus === "ASSIGNED") {
        if (!workOrder.assignedTechnicianId) {
            throw new WorkOrderAssignmentNotAllowedError(
                "Cannot transition work order to ASSIGNED without an assigned technician.",
            );
        }
    }

    if (toStatus === "COMPLETED") {
        if (!workOrder.assignedTechnicianId) {
            throw new WorkOrderCompletionPreconditionFailedError();
        }
    }

    // --- 9. Apply Transition Side Effects ---
    const now = new Date();
    const updateData: {
        status: WorkOrderStatus;
        assignedTechnicianId?: string | null;
        startedAt?: Date;
        completedAt?: Date;
        cancelledAt?: Date;
        holdReason?: string | null;
        cancellationReason?: string | null;
    } = {
        status: toStatus,
    };

    if (toStatus === "OPEN") {
        // ASSIGNED -> OPEN: clear assigned technician
        updateData.assignedTechnicianId = null;
    } else if (toStatus === "IN_PROGRESS") {
        // Sets startedAt = now() if null (resuming from ON_HOLD does not overwrite)
        if (!workOrder.startedAt) {
            updateData.startedAt = now;
        }
        // Clears hold state if resuming from ON_HOLD
        if (fromStatus === "ON_HOLD") {
            updateData.holdReason = null;
        }
    } else if (toStatus === "ON_HOLD") {
        updateData.holdReason = data.holdReason ?? null;
    } else if (toStatus === "COMPLETED") {
        updateData.completedAt = now;
    } else if (toStatus === "CANCELLED") {
        updateData.cancelledAt = now;
        updateData.cancellationReason = data.cancellationReason ?? null;
    } else if (toStatus === "ASSIGNED" && fromStatus === "ON_HOLD") {
        // Re-queue assigned work from ON_HOLD: clears hold state
        updateData.holdReason = null;
    }

    // --- 10. Persist Update & Operational History in Transaction ---
    const executeInTx = async (tx: any) => {
        const wo = await tx.workOrder.update({
            where: {
                id: workOrderId,
            },
            data: updateData,
            include: {
                customer: true,
                location: true,
                workType: true,
            },
        });

        const createdHistory = await tx.workOrderHistory.create({
            data: {
                workspaceId,
                workOrderId,
                eventType: "STATUS_CHANGED",
                actorMemberId: authorization.membership.id,
                actorName: authorization.user.name || authorization.user.email,
                field: "status",
                oldValue: fromStatus,
                newValue: toStatus,
                metadata: JSON.stringify({
                    holdReason: updateData.holdReason ?? undefined,
                    cancellationReason: updateData.cancellationReason ?? undefined,
                }),
            },
        });

        // Phase 1.13.9: Emit corresponding WorkOrder lifecycle notification event in same transaction
        if (toStatus === "IN_PROGRESS") {
            if (fromStatus === "ON_HOLD") {
                await emitNotificationEvent(tx, {
                    workspaceId,
                    eventType: NotificationEventType.WORK_ORDER_RESUMED,
                    sourceEntity: "WorkOrder",
                    sourceId: workOrderId,
                    actorMemberId: authorization.membership.id,
                    payload: {
                        workOrderId,
                        workOrderNumber: wo.workOrderNumber,
                        title: wo.title,
                        customerId: wo.customerId,
                        technicianId: wo.assignedTechnicianId ?? undefined,
                        resumedAt: now.toISOString(),
                    },
                });
            } else {
                await emitNotificationEvent(tx, {
                    workspaceId,
                    eventType: NotificationEventType.WORK_ORDER_STARTED,
                    sourceEntity: "WorkOrder",
                    sourceId: workOrderId,
                    actorMemberId: authorization.membership.id,
                    payload: {
                        workOrderId,
                        workOrderNumber: wo.workOrderNumber,
                        title: wo.title,
                        customerId: wo.customerId,
                        technicianId: wo.assignedTechnicianId ?? undefined,
                        startedAt: (wo.startedAt ?? now).toISOString(),
                    },
                });
            }
        } else if (toStatus === "ON_HOLD") {
            await emitNotificationEvent(tx, {
                workspaceId,
                eventType: NotificationEventType.WORK_ORDER_PAUSED,
                sourceEntity: "WorkOrder",
                sourceId: workOrderId,
                actorMemberId: authorization.membership.id,
                payload: {
                    workOrderId,
                    workOrderNumber: wo.workOrderNumber,
                    title: wo.title,
                    customerId: wo.customerId,
                    technicianId: wo.assignedTechnicianId ?? undefined,
                    pausedAt: now.toISOString(),
                    holdReason: wo.holdReason ?? undefined,
                },
            });
        } else if (toStatus === "COMPLETED") {
            await emitNotificationEvent(tx, {
                workspaceId,
                eventType: NotificationEventType.WORK_ORDER_COMPLETED,
                sourceEntity: "WorkOrder",
                sourceId: workOrderId,
                actorMemberId: authorization.membership.id,
                payload: {
                    workOrderId,
                    workOrderNumber: wo.workOrderNumber,
                    title: wo.title,
                    customerId: wo.customerId,
                    customerName: wo.customer.name,
                    technicianId: wo.assignedTechnicianId ?? undefined,
                    completedAt: (wo.completedAt ?? now).toISOString(),
                },
            });
        } else if (toStatus === "CANCELLED") {
            await emitNotificationEvent(tx, {
                workspaceId,
                eventType: NotificationEventType.WORK_ORDER_CANCELLED,
                sourceEntity: "WorkOrder",
                sourceId: workOrderId,
                actorMemberId: authorization.membership.id,
                payload: {
                    workOrderId,
                    workOrderNumber: wo.workOrderNumber,
                    title: wo.title,
                    customerId: wo.customerId,
                    cancelledAt: (wo.cancelledAt ?? now).toISOString(),
                    cancellationReason: wo.cancellationReason ?? undefined,
                },
            });
        } else {
            await emitNotificationEvent(tx, {
                workspaceId,
                eventType: NotificationEventType.WORK_ORDER_STATUS_CHANGED,
                sourceEntity: "WorkOrder",
                sourceId: workOrderId,
                actorMemberId: authorization.membership.id,
                payload: {
                    workOrderId,
                    workOrderNumber: wo.workOrderNumber,
                    title: wo.title,
                    customerId: wo.customerId,
                    previousStatus: fromStatus,
                    newStatus: toStatus,
                },
            });
        }

        return {
            wo,
            historyRecordId: createdHistory?.id,
        };
    };

    const updated = txClient
        ? await executeInTx(txClient)
        : await prisma.$transaction(executeInTx);

    const locationAddress = [
        updated.wo.location.addressLine1,
        updated.wo.location.addressLine2,
        updated.wo.location.city,
        updated.wo.location.state,
        updated.wo.location.postalCode,
        updated.wo.location.country,
    ]
        .filter(Boolean)
        .join(", ");

    return {
        id: updated.wo.id,
        workspaceId: updated.wo.workspaceId,
        workOrderNumber: updated.wo.workOrderNumber,

        customerId: updated.wo.customerId,
        customerName: updated.wo.customer.name,
        customerNumber: updated.wo.customer.customerNumber,

        locationId: updated.wo.locationId,
        locationName: updated.wo.location.name,
        locationAddress,

        workTypeId: updated.wo.workTypeId,
        workTypeName: updated.wo.workTypeName,
        workTypeCode: updated.wo.workTypeCode,
        estimatedDuration: updated.wo.estimatedDuration,

        assignedTechnicianId: updated.wo.assignedTechnicianId,
        assetId: updated.wo.assetId ?? null,

        status: updated.wo.status,
        priority: updated.wo.priority,

        title: updated.wo.title,
        description: updated.wo.description,
        internalNotes: updated.wo.internalNotes,
        holdReason: updated.wo.holdReason,
        cancellationReason: updated.wo.cancellationReason,

        startedAt: updated.wo.startedAt,
        completedAt: updated.wo.completedAt,
        cancelledAt: updated.wo.cancelledAt,

        createdAt: updated.wo.createdAt,
        updatedAt: updated.wo.updatedAt,

        _historyRecordId: updated.historyRecordId,
    };
}
