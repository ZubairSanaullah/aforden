import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { WorkOrderNotFoundError } from "./workOrderErrors";
import type { WorkOrderReadModel } from "./workOrder.types";
import type {
    Customer,
    ServiceLocation,
    WorkType,
    WorkOrder,
    Prisma,
} from "@/generated/prisma/client";

export type WorkOrderWithRelations = WorkOrder & {
    customer: Customer;
    location: ServiceLocation;
    workType: WorkType;
};

/**
 * Maps a Prisma WorkOrder record with its includes to the standard WorkOrderReadModel.
 */
export function toWorkOrderReadModel(record: WorkOrderWithRelations): WorkOrderReadModel {
    const locationAddress = [
        record.location.addressLine1,
        record.location.addressLine2,
        record.location.city,
        record.location.state,
        record.location.postalCode,
        record.location.country,
    ]
        .filter(Boolean)
        .join(", ");

    return {
        id: record.id,
        workspaceId: record.workspaceId,
        workOrderNumber: record.workOrderNumber,

        customerId: record.customerId,
        customerName: record.customer.name,
        customerNumber: record.customer.customerNumber,

        locationId: record.locationId,
        locationName: record.location.name,
        locationAddress,

        workTypeId: record.workTypeId,
        workTypeName: record.workTypeName,
        workTypeCode: record.workTypeCode,
        estimatedDuration: record.estimatedDuration,

        assignedTechnicianId: record.assignedTechnicianId,
        assetId: record.assetId ?? null,

        status: record.status,
        priority: record.priority,

        title: record.title,
        description: record.description,
        internalNotes: record.internalNotes,
        holdReason: record.holdReason,
        cancellationReason: record.cancellationReason,

        startedAt: record.startedAt,
        completedAt: record.completedAt,
        cancelledAt: record.cancelledAt,

        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

/**
 * Retrieves a single WorkOrder by ID within an authorized workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the WORK_ORDERS_VIEW permission.
 *   - TECHNICIAN role is scoped strictly to WorkOrders assigned to their technician profile.
 *   - Query is strictly tenant-scoped (`where: { id: workOrderId, workspaceId }`).
 *   - Returns canonical WorkOrderReadModel.
 *   - Cross-tenant lookups throw WorkOrderNotFoundError (404) to prevent IDOR existence leakage.
 */
export async function getWorkOrder(
    workspaceId: string,
    workOrderId: string,
): Promise<WorkOrderReadModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    const role = authorization.membership.role;

    // --- 2. RBAC: Enforce WORK_ORDERS_VIEW permission ---
    assertPermission(role, PERMISSIONS.WORK_ORDERS_VIEW);

    // --- 3. Build Scoped Where Filter ---
    const where: Prisma.WorkOrderWhereInput = {
        id: workOrderId,
        workspaceId,
    };

    // --- 4. Role-Specific Scoping for TECHNICIAN (Phase 1.6.1 §8.2) ---
    if (role === "TECHNICIAN") {
        where.assignedTechnician = {
            employee: {
                workspaceId,
                workspaceMemberId: authorization.membership.id,
            },
        };
    }

    // --- 5. Tenant-Scoped WorkOrder Lookup with Single-Query Relations (No N+1) ---
    const workOrder = await prisma.workOrder.findFirst({
        where,
        include: {
            customer: true,
            location: true,
            workType: true,
        },
    });

    if (!workOrder) {
        throw new WorkOrderNotFoundError();
    }

    return toWorkOrderReadModel(workOrder);
}
