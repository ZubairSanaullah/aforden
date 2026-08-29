import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { updateWorkOrderSchema } from "@/lib/validations/workOrder";
import {
    WorkOrderNotFoundError,
    WorkOrderImmutableError,
    WorkOrderAssetCustomerMismatchError,
    WorkOrderAssetLocationMismatchError,
} from "./workOrderErrors";
import {
    AssetNotFoundError,
    AssetImmutableError,
} from "@/lib/services/asset/assetErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { WorkOrderReadModel } from "./workOrder.types";
import type {
    Customer,
    ServiceLocation,
    WorkType,
    WorkOrder,
    WorkOrderPriority,
} from "@/generated/prisma/client";

export type WorkOrderWithRelations = WorkOrder & {
    customer: Customer;
    location: ServiceLocation;
    workType: WorkType;
};

/**
 * Maps a Prisma WorkOrder record with its includes to the standard WorkOrderReadModel.
 */
function toWorkOrderReadModel(updated: WorkOrderWithRelations): WorkOrderReadModel {
    const locationAddress = [
        updated.location.addressLine1,
        updated.location.addressLine2,
        updated.location.city,
        updated.location.state,
        updated.location.postalCode,
        updated.location.country,
    ]
        .filter(Boolean)
        .join(", ");

    return {
        id: updated.id,
        workspaceId: updated.workspaceId,
        workOrderNumber: updated.workOrderNumber,

        customerId: updated.customerId,
        customerName: updated.customer.name,
        customerNumber: updated.customer.customerNumber,

        locationId: updated.locationId,
        locationName: updated.location.name,
        locationAddress,

        workTypeId: updated.workTypeId,
        workTypeName: updated.workTypeName,
        workTypeCode: updated.workTypeCode,
        estimatedDuration: updated.estimatedDuration,

        assignedTechnicianId: updated.assignedTechnicianId,
        assetId: updated.assetId ?? null,

        status: updated.status,
        priority: updated.priority,

        title: updated.title,
        description: updated.description,
        internalNotes: updated.internalNotes,
        holdReason: updated.holdReason,
        cancellationReason: updated.cancellationReason,

        startedAt: updated.startedAt,
        completedAt: updated.completedAt,
        cancelledAt: updated.cancelledAt,

        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
    };
}

/**
 * Updates mutable fields on an existing WorkOrder within an authorized workspace.
 *
 * Sequence of operations & invariants:
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC Permission Assertion (`assertPermission(role, PERMISSIONS.WORK_ORDERS_UPDATE)`).
 *   3. Validate Input Payload (`updateWorkOrderSchema.parse(input)`).
 *   4. Tenant-Scoped WorkOrder Resolution (`findFirst({ where: { id, workspaceId } })` -> 404 IDOR protection).
 *   5. Terminal State Guard (COMPLETED / CANCELLED -> 409 `WorkOrderImmutableError`).
 *   6. Role-Specific Scoping & Priority Gating:
 *      - TECHNICIAN: must be the assigned worker (`assignedTechnicianId === callerProfile.id`)
 *        AND cannot mutate `priority` (403 Forbidden).
 *      - OWNER, ADMIN, MANAGER, DISPATCHER: full operational field update authority.
 *   6.5. Optional Asset Resolution & Consistency Checks (Phase 1.7.7 §9.2 & §17.3):
 *      - If assetId is provided: lookup Asset in workspace (404 AssetNotFoundError if missing).
 *      - Reject RETIRED assets with AssetImmutableError (409).
 *      - If Asset has customerId, assert customerId === workOrder.customerId (422 WorkOrderAssetCustomerMismatchError).
 *      - If Asset has locationId, assert locationId === workOrder.locationId (422 WorkOrderAssetLocationMismatchError).
 *      - If Asset is a depot asset (customerId === null), skip customer/location checks (depot deployment).
 *   7. Safe Mutation of Approved Mutable Fields (`title`, `priority`, `description`, `internalNotes`, `assetId`).
 *   8. Return standard `WorkOrderReadModel`.
 */
export async function updateWorkOrder(
    workspaceId: string,
    workOrderId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<WorkOrderReadModel> {
    // --- 1. Authenticate & Authorize Workspace Context ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));
    const role = authorization.membership.role;

    // --- 2. RBAC Permission Check (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN) ---
    assertPermission(role, PERMISSIONS.WORK_ORDERS_UPDATE);

    // --- 3. Validate Input Payload (strict schema prevents unknown/controlled fields) ---
    const data = updateWorkOrderSchema.parse(input);

    // --- 4. Tenant-Scoped WorkOrder Lookup ---
    const workOrder = await prisma.workOrder.findFirst({
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

    // --- 5. Terminal State Guard ---
    if (workOrder.status === "COMPLETED" || workOrder.status === "CANCELLED") {
        throw new WorkOrderImmutableError();
    }

    // --- 6. Role-Specific Scoping & Priority Gating ---
    if (role === "TECHNICIAN") {
        const callerProfile = await prisma.technicianProfile.findFirst({
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

        if (
            !callerProfile ||
            !workOrder.assignedTechnicianId ||
            workOrder.assignedTechnicianId !== callerProfile.id
        ) {
            throw new ForbiddenError(
                "Technicians can only update work orders assigned to them.",
            );
        }

        if (data.priority !== undefined) {
            throw new ForbiddenError(
                "Technicians are not authorized to update work order priority.",
            );
        }
    }

    // --- 6.5. Asset Resolution & Consistency Checks (§9.2 & §17.3) ---
    if (data.assetId !== undefined && data.assetId !== null && data.assetId !== workOrder.assetId) {
        const asset = await prisma.asset.findFirst({
            where: {
                id: data.assetId,
                workspaceId,
            },
        });

        if (!asset) {
            throw new AssetNotFoundError();
        }

        if (asset.status === "RETIRED") {
            throw new AssetImmutableError(
                "Cannot associate a work order with a retired asset.",
            );
        }

        if (asset.customerId !== null) {
            if (asset.customerId !== workOrder.customerId) {
                throw new WorkOrderAssetCustomerMismatchError();
            }

            if (asset.locationId !== null && asset.locationId !== workOrder.locationId) {
                throw new WorkOrderAssetLocationMismatchError();
            }
        }
    }

    // --- 7. Apply Safe Mutation to Approved Mutable Fields ---
    const updateData: {
        title?: string;
        priority?: WorkOrderPriority;
        description?: string | null;
        internalNotes?: string | null;
        assetId?: string | null;
    } = {};

    if (data.title !== undefined) {
        updateData.title = data.title;
    }
    if (data.priority !== undefined) {
        updateData.priority = data.priority;
    }
    if (data.description !== undefined) {
        updateData.description = data.description;
    }
    if (data.internalNotes !== undefined) {
        updateData.internalNotes = data.internalNotes;
    }
    if (data.assetId !== undefined) {
        updateData.assetId = data.assetId;
    }

    // --- 8. Persist Mutation & Operational History in Transaction ---
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        const wo = await tx.workOrder.update({
            where: { id: workOrderId },
            data: updateData,
            include: { customer: true, location: true, workType: true },
        });

        const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
        if (data.title !== undefined && data.title !== workOrder.title) {
            changes.push({ field: "title", oldValue: workOrder.title, newValue: data.title });
        }
        if (data.priority !== undefined && data.priority !== workOrder.priority) {
            changes.push({ field: "priority", oldValue: workOrder.priority, newValue: data.priority });
        }
        if (data.description !== undefined && data.description !== workOrder.description) {
            changes.push({ field: "description", oldValue: workOrder.description, newValue: data.description });
        }
        if (data.internalNotes !== undefined && data.internalNotes !== workOrder.internalNotes) {
            changes.push({ field: "internalNotes", oldValue: workOrder.internalNotes, newValue: data.internalNotes });
        }
        if (data.assetId !== undefined && data.assetId !== workOrder.assetId) {
            changes.push({ field: "assetId", oldValue: workOrder.assetId, newValue: data.assetId });
        }

        if (tx.workOrderHistory?.create) {
            const isRealMember = !authorization.membership.id.startsWith("api_");
            for (const change of changes) {
                await tx.workOrderHistory.create({
                    data: {
                        workspaceId,
                        workOrderId,
                        eventType: "UPDATED",
                        actorMemberId: isRealMember ? authorization.membership.id : null,
                        actorName: authorization.user.name || authorization.user.email || "Public API Application",
                        field: change.field,
                        oldValue: change.oldValue,
                        newValue: change.newValue,
                    },
                });
            }
        }

        return wo;
    });

    // --- 9. Return Canonical Read Model ---
    return toWorkOrderReadModel(updated);
}
