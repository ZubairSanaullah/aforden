/**
 * Phase 1.11.7 — Evaluate Quote Expiration Service
 * Automated / scheduled batch operation that transitions past-due PENDING_APPROVAL quotes to EXPIRED.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

export interface EvaluateQuoteExpirationResult {
    evaluatedCount: number;
    expiredCount: number;
    expiredQuoteIds: string[];
}

/**
 * Evaluates pending quotes and transitions any whose validUntil date has elapsed to EXPIRED.
 * Can be run across all workspaces, within a specific workspace, or for a single quote.
 */
export async function evaluateQuoteExpiration(
    workspaceId?: string,
    quoteId?: string,
): Promise<EvaluateQuoteExpirationResult> {
    const now = new Date();

    const whereClause: Prisma.QuoteWhereInput = {
        status: "PENDING_APPROVAL",
        validUntil: {
            lt: now,
        },
        ...(workspaceId && { workspaceId }),
        ...(quoteId && { id: quoteId }),
    };

    const expiredQuotes = await prisma.quote.findMany({
        where: whereClause,
        select: {
            id: true,
            workspaceId: true,
            quoteNumber: true,
            title: true,
            customerId: true,
            customer: {
                select: {
                    name: true,
                },
            },
            total: true,
            validUntil: true,
        },
    });

    const expiredQuoteIds: string[] = [];

    for (const q of expiredQuotes) {
        await prisma.$transaction(async (tx) => {
            await tx.quote.update({
                where: { id: q.id },
                data: {
                    status: "EXPIRED",
                },
            });

            await tx.quoteHistory.create({
                data: {
                    quoteId: q.id,
                    workspaceId: q.workspaceId,
                    eventType: "EXPIRED",
                    actorMemberId: null,
                    actorName: null,
                    field: "status",
                    oldValue: "PENDING_APPROVAL",
                    newValue: "EXPIRED",
                    metadata: {
                        system: true,
                        reason: "Quote validity period expired",
                        validUntil: q.validUntil ? q.validUntil.toISOString() : null,
                        evaluatedAt: now.toISOString(),
                    },
                },
            });

            // Phase 1.13.9: Emit QUOTE_EXPIRED in same transaction
            await emitNotificationEvent(tx, {
                workspaceId: q.workspaceId,
                eventType: NotificationEventType.QUOTE_EXPIRED,
                sourceEntity: "Quote",
                sourceId: q.id,
                actorMemberId: null, // System event
                payload: {
                    quoteId: q.id,
                    quoteNumber: q.quoteNumber,
                    title: q.title || `Quote ${q.quoteNumber}`,
                    customerId: q.customerId || "customer_unknown",
                    customerName: q.customer?.name,
                    totalAmount:
                        typeof q.total === "object" && (q.total as any)?.toFixed
                            ? (q.total as any).toFixed(2)
                            : String(q.total ?? "0.00"),
                    expiredAt: now.toISOString(),
                },
            });
        });

        expiredQuoteIds.push(q.id);
    }

    return {
        evaluatedCount: expiredQuotes.length,
        expiredCount: expiredQuoteIds.length,
        expiredQuoteIds,
    };
}
