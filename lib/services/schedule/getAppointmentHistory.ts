import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    getAppointmentHistoryQuerySchema,
    type GetAppointmentHistoryQueryInput,
} from "./schedule.schemas";
import {
    type ScheduleAppointmentHistoryReadModel,
    type ScheduleAppointmentHistoryListResult,
} from "./schedule.types";
import { ScheduleAppointmentNotFoundError } from "./scheduleErrors";

export function toScheduleAppointmentHistoryReadModel(
    history: any,
): ScheduleAppointmentHistoryReadModel {
    return {
        id: history.id,
        workspaceId: history.workspaceId,
        appointmentId: history.appointmentId,
        eventType: history.eventType,
        actorMemberId: history.actorMemberId ?? null,
        actorName: history.actorName ?? null,
        field: history.field ?? null,
        oldValue: history.oldValue ?? null,
        newValue: history.newValue ?? null,
        metadata: (history.metadata as Record<string, any>) ?? null,
        createdAt: history.createdAt,
    };
}

/**
 * Retrieves the complete operational and audit history for a single appointment (§4.2, §15).
 *
 * Security & Query Invariants:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SCHEDULER_VIEW permission.
 *   - Target lookup is strictly tenant-scoped (`where: { id: appointmentId, workspaceId }`).
 *   - Results are returned in chronological order (`orderBy: { createdAt: "asc" }`).
 *   - Paginated with standard metadata (page, limit, total, totalPages, hasNextPage, hasPreviousPage).
 */
export async function getAppointmentHistory(
    workspaceId: string,
    appointmentId: string,
    query: Partial<GetAppointmentHistoryQueryInput> = {},
): Promise<ScheduleAppointmentHistoryListResult> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);
    const role = authorization.membership.role;

    // --- 2. RBAC: Enforce SCHEDULER_VIEW Permission ---
    assertPermission(role, PERMISSIONS.SCHEDULER_VIEW);

    // --- 3. Validate Query Parameters ---
    const parsedQuery = getAppointmentHistoryQuerySchema.parse(query);
    const { page, limit } = parsedQuery;
    const skip = (page - 1) * limit;

    // --- 4. Tenant-Scoped Appointment Existence Verification ---
    const appointment = await prisma.scheduleAppointment.findFirst({
        where: {
            id: appointmentId,
            workspaceId,
        },
        select: {
            id: true,
        },
    });

    if (!appointment) {
        throw new ScheduleAppointmentNotFoundError();
    }

    // --- 5. Query Audit History in Chronological Order ---
    const [historyRows, total] = await Promise.all([
        prisma.scheduleAppointmentHistory.findMany({
            where: {
                workspaceId,
                appointmentId,
            },
            orderBy: {
                createdAt: "asc",
            },
            skip,
            take: limit,
        }),
        prisma.scheduleAppointmentHistory.count({
            where: {
                workspaceId,
                appointmentId,
            },
        }),
    ]);

    // --- 6. Shape Read Models & Pagination Metadata ---
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const items = historyRows.map(toScheduleAppointmentHistoryReadModel);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
        },
    };
}
