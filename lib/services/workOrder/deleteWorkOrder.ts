import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    WorkOrderNotFoundError,
    WorkOrderDeletionNotAllowedError,
} from "./workOrderErrors";
import { toWorkOrderReadModel } from "./getWorkOrder";
import type { WorkOrderReadModel } from "./workOrder.types";

/**
 * Administratively deletes an eligible WorkOrder from an authorized workspace.
 *
 * Security & Deletion Invariants:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the WORK_ORDERS_DELETE permission (OWNER or ADMIN).
 *   - Target lookup is strictly tenant-scoped (`where: { id: workOrderId, workspaceId }`).
 *   - Only WorkOrders in `OPEN` or `CANCELLED` status are eligible for deletion.
 *     WorkOrders in active or completed execution (`ASSIGNED`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`)
 *     cannot be deleted (rejected with 409 `WorkOrderDeletionNotAllowedError`).
 *   - Physical deletion releases foreign key dependencies on Customer, ServiceLocation, WorkType,
 *     and TechnicianProfile without cascading or modifying parent records.
 *   - Returns deleted canonical WorkOrderReadModel.
 */
export async function deleteWorkOrder(
    workspaceId: string,
    workOrderId: string,
): Promise<WorkOrderReadModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    const role = authorization.membership.role;

    // --- 2. RBAC: Enforce WORK_ORDERS_DELETE permission (OWNER, ADMIN) ---
    assertPermission(role, PERMISSIONS.WORK_ORDERS_DELETE);

    // --- 3. Locate Existing WorkOrder in Workspace ---
    const existing = await prisma.workOrder.findFirst({
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

    if (!existing) {
        throw new WorkOrderNotFoundError();
    }

    // --- 4. Assert Domain Deletion Invariants ---
    if (existing.status !== "OPEN" && existing.status !== "CANCELLED") {
        throw new WorkOrderDeletionNotAllowedError(
            `Work order deletion is not permitted for status '${existing.status}'. Only OPEN or CANCELLED work orders can be deleted.`,
        );
    }

    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    // --- 5. Record DELETED Operational History & Execute Deletion in Transaction ---
    await runTx(async (tx) => {
        if (tx.workOrderHistory?.create) {
            await tx.workOrderHistory.create({
                data: {
                    workspaceId,
                    workOrderId,
                    eventType: "DELETED",
                    actorMemberId: authorization.membership.id,
                    actorName: authorization.user.name || authorization.user.email,
                    oldValue: existing.workOrderNumber,
                    metadata: JSON.stringify({
                        workOrderNumber: existing.workOrderNumber,
                        title: existing.title,
                        status: existing.status,
                        priority: existing.priority,
                        customerId: existing.customerId,
                        locationId: existing.locationId,
                        workTypeId: existing.workTypeId,
                    }),
                },
            });
        }

        await tx.workOrder.delete({
            where: {
                id: workOrderId,
            },
        });
    });

    return toWorkOrderReadModel(existing);
}
