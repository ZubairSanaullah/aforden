import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    getTechnicianAssignmentConflictsQuerySchema,
    type GetTechnicianAssignmentConflictsQueryInput,
} from "@/lib/validations/technicianAssignmentQuery";
import type { TechnicianAssignmentConflict } from "./technicianAssignmentOverview.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Evaluates and returns all active assignment conflicts for a technician in a requested interval.
 *
 * Conflict rules:
 *   - Only `ASSIGNED` status blocks scheduling.
 *   - `CANCELLED` and `COMPLETED` assignments are never conflicts.
 *   - Overlap interval: `existing.startsAt < requested.endsAt && requested.startsAt < existing.endsAt`.
 *   - Touching boundaries (e.g. 08:00–12:00 and 12:00–16:00) are NOT conflicts.
 *   - If `excludeAssignmentId` is provided, that assignment is ignored.
 *   - Strictly tenant scoped.
 *   - Zero mutation side effects.
 */
export async function getTechnicianAssignmentConflicts(
    workspaceId: string,
    technicianProfileId: string,
    input: GetTechnicianAssignmentConflictsQueryInput,
): Promise<TechnicianAssignmentConflict[]> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Read Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Validate Input Schema ---
    const data = getTechnicianAssignmentConflictsQuerySchema.parse(input);

    // --- Tenant-Scoped Conflict Query ---
    const where: Prisma.TechnicianAssignmentWhereInput = {
        technicianProfileId,
        technicianProfile: {
            employee: {
                workspaceId,
            },
        },
        status: "ASSIGNED",
        startsAt: {
            lt: data.endsAt,
        },
        endsAt: {
            gt: data.startsAt,
        },
        ...(data.excludeAssignmentId
            ? { id: { not: data.excludeAssignmentId } }
            : {}),
    };

    const conflicts = await prisma.technicianAssignment.findMany({
        where,
        orderBy: [
            { startsAt: "asc" },
            { endsAt: "asc" },
            { id: "asc" },
        ],
        select: {
            id: true,
            workType: true,
            workReferenceId: true,
            status: true,
            startsAt: true,
            endsAt: true,
            notes: true,
        },
    });

    return conflicts.map((c) => ({
        id: c.id,
        workType: c.workType,
        workReferenceId: c.workReferenceId,
        status: c.status,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        notes: c.notes,
    }));
}
