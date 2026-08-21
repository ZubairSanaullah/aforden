import { Prisma, type ScheduleHistoryEventType } from "@/generated/prisma/client";

export interface RecordScheduleHistoryParams {
    workspaceId: string;
    appointmentId: string;
    eventType: ScheduleHistoryEventType;
    actorMemberId?: string | null;
    actorName?: string | null;
    field?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
    metadata?: Record<string, any> | null;
}

/**
 * Authoritative, transaction-enforced writer for ScheduleAppointmentHistory (§4.2, §15).
 *
 * Invariant (Phase 1.8.1 §12 Step 6, §15):
 * - Must be passed the active transaction client `tx` (not ambient prisma).
 * - Guaranteed Atomicity: Throws immediately if `tx` is missing or invalid, preventing
 *   silent, unaudited mutations.
 */
export async function recordScheduleHistory(
    tx: Prisma.TransactionClient,
    params: RecordScheduleHistoryParams,
): Promise<any> {
    if (!tx || typeof tx.scheduleAppointmentHistory?.create !== "function") {
        throw new Error(
            "recordScheduleHistory requires a valid Prisma transaction client with a scheduleAppointmentHistory.create delegate.",
        );
    }

    return tx.scheduleAppointmentHistory.create({
        data: {
            workspaceId: params.workspaceId,
            appointmentId: params.appointmentId,
            eventType: params.eventType,
            actorMemberId: params.actorMemberId ?? null,
            actorName: params.actorName ?? null,
            field: params.field ?? null,
            oldValue: params.oldValue ?? null,
            newValue: params.newValue ?? null,
            metadata: params.metadata !== undefined && params.metadata !== null
                ? (params.metadata as Prisma.InputJsonValue)
                : Prisma.JsonNull,
        },
    });
}
