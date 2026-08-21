import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import {
    toTechnicianTimeEntryReadModel,
    type TechnicianTimeEntryReadModel,
} from "./technicianOperations.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Administratively lists technician time entries for a specified WorkOrder within the authorized workspace.
 *
 * Operational & Invariant Rules:
 * - Section 2.2 (Invariant 2): Authenticates via standard workspace authorization (`requireWorkspaceAuthorization`).
 * - Section 11.1 (RBAC): Permits `OWNER`, `ADMIN`, and `MANAGER` roles.
 *   `DISPATCHER`, `TECHNICIAN`, and `ACCOUNTANT` roles throw `ForbiddenError` (403).
 * - Allows administrative callers to view all time entries for the WorkOrder across all technicians,
 *   or filter by a specific `technicianProfileId`.
 * - Returns an array of canonical `TechnicianTimeEntryReadModel` objects.
 */
export async function listTechnicianTimeEntriesAdmin(
    workspaceId: string,
    workOrderId: string,
    options?: { technicianProfileId?: string }
): Promise<TechnicianTimeEntryReadModel[]> {
    if (!workspaceId || typeof workspaceId !== "string" || !workspaceId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    // 1. Authenticate session & verify active membership in workspace
    const authorization = await requireWorkspaceAuthorization(workspaceId.trim());

    // 2. Role Guard (RBAC Matrix §11.1: OWNER, ADMIN, MANAGER)
    if (
        authorization.membership.role !== "OWNER" &&
        authorization.membership.role !== "ADMIN" &&
        authorization.membership.role !== "MANAGER"
    ) {
        throw new ForbiddenError(
            "Only OWNER, ADMIN, and MANAGER roles are authorized to view administrative time entries."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();

    // 3. Resolve WorkOrder in Workspace
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: trimmedWorkOrderId,
            workspaceId: authorization.workspace.id,
        },
        select: { id: true },
    });

    if (!workOrder) {
        throw new WorkOrderNotFoundError();
    }

    // 4. Query Time Entries
    const whereClause: Prisma.TechnicianTimeEntryWhereInput = {
        workspaceId: authorization.workspace.id,
        workOrderId: trimmedWorkOrderId,
    };

    if (options?.technicianProfileId && options.technicianProfileId.trim()) {
        whereClause.technicianProfileId = options.technicianProfileId.trim();
    }

    const entries = await prisma.technicianTimeEntry.findMany({
        where: whereClause,
        orderBy: { startedAt: "desc" },
    });

    return entries.map(toTechnicianTimeEntryReadModel);
}
