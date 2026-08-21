import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { toWorkOrderReadModel } from "@/lib/services/workOrder/getWorkOrder";
import type { TechnicianExecutionContext } from "./technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";
import type { Prisma, MembershipRole } from "@/generated/prisma/client";

const ALLOWED_ROLES: MembershipRole[] = [
    "OWNER",
    "ADMIN",
    "MANAGER",
    "DISPATCHER",
    "TECHNICIAN",
];

/**
 * Retrieves the operational detail of a single WorkOrder for the authenticated technician.
 *
 * Invariant & Security Guarantees:
 * - RBAC: OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN are authorized. ACCOUNTANT throws ForbiddenError (403).
 * - Invariant 3 (Tenant & Technician Isolation & Anti-IDOR Protection):
 *   - For TECHNICIAN role: Query enforces `id === workOrderId`, `workspaceId === context.workspaceId`,
 *     and `assignedTechnicianId === context.technicianProfileId`.
 *   - If the WorkOrder exists in the workspace but belongs to another technician, the query returns null
 *     and throws WorkOrderNotFoundError (404 Not Found), NEVER 403, preventing entity existence leakage (§2.3).
 * - Single-query relation projection avoids N+1 and returns canonical WorkOrderReadModel.
 */
export async function getTechnicianWorkOrderDetail(
    context: TechnicianExecutionContext,
    workOrderId: string
): Promise<WorkOrderReadModel> {
    // 1. RBAC Authorization Check (Section 11)
    if (!ALLOWED_ROLES.includes(context.role)) {
        throw new ForbiddenError("You do not have permission to view work order operational details.");
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    // 2. Build Scoped Where Filter (Section 2.3)
    const where: Prisma.WorkOrderWhereInput = {
        id: workOrderId.trim(),
        workspaceId: context.workspaceId,
    };

    if (context.role === "TECHNICIAN") {
        where.assignedTechnicianId = context.technicianProfileId;
    }

    // 3. Single-Query Tenant-Scoped Lookup
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

    // 4. Return Canonical Read Model Projection
    return toWorkOrderReadModel(workOrder);
}
