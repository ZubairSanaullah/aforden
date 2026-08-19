import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertAnyPermission } from "@/lib/services/authorization/permissionService";
import {
    getTechnicianAssignmentTimelineQuerySchema,
    type GetTechnicianAssignmentTimelineQueryInput,
} from "@/lib/validations/technicianAssignmentHistory";
import type {
    TechnicianAssignmentHistoryEvent,
    AssignmentHistoryEventType,
} from "./technicianAssignmentHistory.types";

/**
 * Derives a chronological timeline of assignment lifecycle events for a technician within a workspace.
 *
 * Operational & Event derivation guarantees:
 *   - Events derived purely from existing TechnicianAssignment records:
 *       - ASSIGNED -> CREATED (occurredAt: createdAt)
 *       - COMPLETED -> CREATED (createdAt) + COMPLETED (completedAt)
 *       - CANCELLED -> CREATED (createdAt) + CANCELLED (cancelledAt, cancellationReason)
 *   - Timeline date filter applies to event occurrence time: `occurredAt >= from && occurredAt < to`.
 *   - Deterministically sorted: `occurredAt ASC`, `assignmentId ASC`, `type ASC` (CREATED -> COMPLETED -> CANCELLED).
 *   - Zero database mutations.
 *   - Zero credential / authentication secret leakage.
 */
export async function getTechnicianAssignmentTimeline(
    workspaceId: string,
    technicianProfileId: string,
    options?: GetTechnicianAssignmentTimelineQueryInput,
): Promise<TechnicianAssignmentHistoryEvent[]> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce Read Permission (OWNER, ADMIN, MANAGER, DISPATCHER) ---
    assertAnyPermission(authorization.membership.role, [
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.SCHEDULER_CREATE,
    ]);

    // --- Validate Query Options ---
    const query =
        getTechnicianAssignmentTimelineQuerySchema.parse(options ?? {});

    // --- Tenant-Scoped Lookup of Technician Profile ---
    const profile = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
        select: {
            id: true,
            employeeId: true,
        },
    });

    if (!profile) {
        return [];
    }

    // --- Fetch All Assignments for Technician ---
    const records = await prisma.technicianAssignment.findMany({
        where: {
            technicianProfileId: profile.id,
            technicianProfile: {
                employee: {
                    workspaceId,
                },
            },
        },
        select: {
            id: true,
            technicianProfileId: true,
            workType: true,
            workReferenceId: true,
            status: true,
            createdAt: true,
            completedAt: true,
            cancelledAt: true,
            cancellationReason: true,
        },
    });

    const events: TechnicianAssignmentHistoryEvent[] = [];

    for (const r of records) {
        // Event 1: Creation
        events.push({
            assignmentId: r.id,
            technicianProfileId: r.technicianProfileId,
            employeeId: profile.employeeId,
            type: "CREATED",
            occurredAt: r.createdAt,
            status: r.status,
            workType: r.workType,
            workReferenceId: r.workReferenceId,
            cancellationReason: null,
        });

        // Event 2: Terminal Lifecycle Event
        if (r.status === "COMPLETED" && r.completedAt) {
            events.push({
                assignmentId: r.id,
                technicianProfileId: r.technicianProfileId,
                employeeId: profile.employeeId,
                type: "COMPLETED",
                occurredAt: r.completedAt,
                status: r.status,
                workType: r.workType,
                workReferenceId: r.workReferenceId,
                cancellationReason: null,
            });
        } else if (r.status === "CANCELLED" && r.cancelledAt) {
            events.push({
                assignmentId: r.id,
                technicianProfileId: r.technicianProfileId,
                employeeId: profile.employeeId,
                type: "CANCELLED",
                occurredAt: r.cancelledAt,
                status: r.status,
                workType: r.workType,
                workReferenceId: r.workReferenceId,
                cancellationReason: r.cancellationReason,
            });
        }
    }

    // --- Filter Events by Occurrence Window [from, to) ---
    const filteredEvents = events.filter((e) => {
        if (query.from && e.occurredAt.getTime() < query.from.getTime()) {
            return false;
        }
        if (query.to && e.occurredAt.getTime() >= query.to.getTime()) {
            return false;
        }
        return true;
    });

    // --- Deterministic Sorting (occurredAt ASC, assignmentId ASC, type ASC) ---
    const typeOrder: Record<AssignmentHistoryEventType, number> = {
        CREATED: 1,
        COMPLETED: 2,
        CANCELLED: 3,
    };

    filteredEvents.sort((a, b) => {
        const timeDiff = a.occurredAt.getTime() - b.occurredAt.getTime();
        if (timeDiff !== 0) return timeDiff;

        const idDiff = a.assignmentId.localeCompare(b.assignmentId);
        if (idDiff !== 0) return idDiff;

        return typeOrder[a.type] - typeOrder[b.type];
    });

    return filteredEvents;
}
