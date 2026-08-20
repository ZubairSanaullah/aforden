import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { assignWorkOrderSchema } from "@/lib/validations/workOrder";
import {
    WorkOrderNotFoundError,
    WorkOrderTechnicianNotFoundError,
    WorkOrderTechnicianNotEligibleError,
    WorkOrderAssignmentNotAllowedError,
} from "./workOrderErrors";
import type { WorkOrderReadModel } from "./workOrder.types";
import type {
    Customer,
    ServiceLocation,
    WorkType,
    WorkOrder,
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
 * Assigns a technician to a currently unassigned WorkOrder within an authorized workspace.
 *
 * Locked Execution Order (Phase 1.6.6):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC Permission check (`assertPermission(role, PERMISSIONS.WORK_ORDERS_ASSIGN)`).
 *   3. Validate Input payload (`assignWorkOrderSchema.parse(input)`).
 *   4. Scoped WorkOrder Resolution (`findFirst({ where: { id, workspaceId } })` -> 404 IDOR protection).
 *   5. Terminal State Guard (COMPLETED / CANCELLED -> 409 `WorkOrderAssignmentNotAllowedError`).
 *   6. State Check: Precondition requires `assignedTechnicianId === null`.
 *   7. Scoped Technician Resolution (`findFirst({ where: { id, employee: { workspaceId } } })` -> 404).
 *   8. Technician Eligibility Check (`employee.status === "ACTIVE"` -> 422 `WorkOrderTechnicianNotEligibleError`).
 *   9. Mutate `assignedTechnicianId = technicianId` via `prisma.workOrder.update`.
 *   10. Return standard `WorkOrderReadModel`.
 */
export async function assignWorkOrder(
    workspaceId: string,
    workOrderId: string,
    input: unknown,
): Promise<WorkOrderReadModel> {
    // --- 1. Authenticate Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC Permission Assertion (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.WORK_ORDERS_ASSIGN,
    );

    // --- 3. Validate Input Payload ---
    const data = assignWorkOrderSchema.parse(input);

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
        throw new WorkOrderAssignmentNotAllowedError();
    }

    // --- 6. State Rule: Assign requires work order to be currently unassigned ---
    if (workOrder.assignedTechnicianId !== null) {
        throw new WorkOrderAssignmentNotAllowedError(
            "Work order is already assigned to a technician. Use reassign instead.",
        );
    }

    // --- 7. Tenant-Scoped Technician Lookup (Phase 1.3 Precedent) ---
    const technician = await prisma.technicianProfile.findFirst({
        where: {
            id: data.technicianId,
            employee: {
                workspaceId,
            },
        },
        include: {
            employee: true,
        },
    });

    if (!technician) {
        throw new WorkOrderTechnicianNotFoundError();
    }

    // --- 8. Technician Eligibility Check (Phase 1.3 Precedent) ---
    if (technician.employee.status !== "ACTIVE") {
        throw new WorkOrderTechnicianNotEligibleError();
    }

    // --- 9. Mutation: Set assignedTechnicianId & Record History in Transaction ---
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        const wo = await tx.workOrder.update({
            where: {
                id: workOrderId,
            },
            data: {
                assignedTechnicianId: technician.id,
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
                    workOrderId,
                    eventType: "ASSIGNED",
                    actorMemberId: authorization.membership.id,
                    actorName: authorization.user.name || authorization.user.email,
                    field: "assignedTechnicianId",
                    oldValue: null,
                    newValue: technician.id,
                    metadata: JSON.stringify({
                        technicianName: technician.employee.displayName,
                        technicianEmployeeNumber: technician.employee.employeeNumber,
                    }),
                },
            });
        }

        return wo;
    });

    // --- 10. Return Read Model ---
    return toWorkOrderReadModel(updated);
}

/**
 * Reassigns an already assigned WorkOrder to a different valid technician.
 *
 * Locked Execution Order (Phase 1.6.6):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC Permission check (`assertPermission(role, PERMISSIONS.WORK_ORDERS_ASSIGN)`).
 *   3. Validate Input payload (`assignWorkOrderSchema.parse(input)`).
 *   4. Scoped WorkOrder Resolution (`findFirst({ where: { id, workspaceId } })` -> 404 IDOR protection).
 *   5. Terminal State Guard (COMPLETED / CANCELLED -> 409 `WorkOrderAssignmentNotAllowedError`).
 *   6. State Check: Precondition requires `assignedTechnicianId !== null`.
 *   7. Scoped Technician Resolution (`findFirst({ where: { id, employee: { workspaceId } } })` -> 404).
 *   8. Technician Eligibility Check (`employee.status === "ACTIVE"` -> 422 `WorkOrderTechnicianNotEligibleError`).
 *   9. Mutate `assignedTechnicianId = technicianId` via `prisma.workOrder.update`.
 *   10. Return standard `WorkOrderReadModel`.
 */
export async function reassignWorkOrder(
    workspaceId: string,
    workOrderId: string,
    input: unknown,
): Promise<WorkOrderReadModel> {
    // --- 1. Authenticate Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC Permission Assertion (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.WORK_ORDERS_ASSIGN,
    );

    // --- 3. Validate Input Payload ---
    const data = assignWorkOrderSchema.parse(input);

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
        throw new WorkOrderAssignmentNotAllowedError();
    }

    // --- 6. State Rule: Reassign requires work order to be currently assigned ---
    if (workOrder.assignedTechnicianId === null) {
        throw new WorkOrderAssignmentNotAllowedError(
            "Work order is not currently assigned. Use assign instead.",
        );
    }

    // --- 7. Tenant-Scoped Technician Lookup (Phase 1.3 Precedent) ---
    const technician = await prisma.technicianProfile.findFirst({
        where: {
            id: data.technicianId,
            employee: {
                workspaceId,
            },
        },
        include: {
            employee: true,
        },
    });

    if (!technician) {
        throw new WorkOrderTechnicianNotFoundError();
    }

    // --- 8. Technician Eligibility Check (Phase 1.3 Precedent) ---
    if (technician.employee.status !== "ACTIVE") {
        throw new WorkOrderTechnicianNotEligibleError();
    }

    // --- 9. Mutation: Update assignedTechnicianId & Record History in Transaction ---
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        const wo = await tx.workOrder.update({
            where: {
                id: workOrderId,
            },
            data: {
                assignedTechnicianId: technician.id,
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
                    workOrderId,
                    eventType: "REASSIGNED",
                    actorMemberId: authorization.membership.id,
                    actorName: authorization.user.name || authorization.user.email,
                    field: "assignedTechnicianId",
                    oldValue: workOrder.assignedTechnicianId,
                    newValue: technician.id,
                    metadata: JSON.stringify({
                        technicianName: technician.employee.displayName,
                        technicianEmployeeNumber: technician.employee.employeeNumber,
                    }),
                },
            });
        }

        return wo;
    });

    // --- 10. Return Read Model ---
    return toWorkOrderReadModel(updated);
}

/**
 * Unassigns the currently assigned technician from a WorkOrder.
 *
 * Locked Execution Order (Phase 1.6.6):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC Permission check (`assertPermission(role, PERMISSIONS.WORK_ORDERS_ASSIGN)`).
 *   3. Scoped WorkOrder Resolution (`findFirst({ where: { id, workspaceId } })` -> 404 IDOR protection).
 *   4. Terminal State Guard (COMPLETED / CANCELLED -> 409 `WorkOrderAssignmentNotAllowedError`).
 *   5. State Check: Precondition requires `assignedTechnicianId !== null`.
 *   6. Mutate `assignedTechnicianId = null` via `prisma.workOrder.update`.
 *   7. Return standard `WorkOrderReadModel`.
 */
export async function unassignWorkOrder(
    workspaceId: string,
    workOrderId: string,
): Promise<WorkOrderReadModel> {
    // --- 1. Authenticate Workspace Context ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC Permission Assertion (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.WORK_ORDERS_ASSIGN,
    );

    // --- 3. Tenant-Scoped WorkOrder Lookup ---
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

    // --- 4. Terminal State Guard ---
    if (workOrder.status === "COMPLETED" || workOrder.status === "CANCELLED") {
        throw new WorkOrderAssignmentNotAllowedError();
    }

    // --- 5. State Rule: Unassign requires work order to be currently assigned ---
    if (workOrder.assignedTechnicianId === null) {
        throw new WorkOrderAssignmentNotAllowedError(
            "Work order is not currently assigned to a technician.",
        );
    }

    // --- 6. Mutation: Set assignedTechnicianId to null & Record History in Transaction ---
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runTx(async (tx) => {
        const wo = await tx.workOrder.update({
            where: {
                id: workOrderId,
            },
            data: {
                assignedTechnicianId: null,
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
                    workOrderId,
                    eventType: "UNASSIGNED",
                    actorMemberId: authorization.membership.id,
                    actorName: authorization.user.name || authorization.user.email,
                    field: "assignedTechnicianId",
                    oldValue: workOrder.assignedTechnicianId,
                    newValue: null,
                    metadata: JSON.stringify({
                        previousTechnicianId: workOrder.assignedTechnicianId,
                    }),
                },
            });
        }

        return wo;
    });

    // --- 7. Return Read Model ---
    return toWorkOrderReadModel(updated);
}
