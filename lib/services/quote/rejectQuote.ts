/**
 * Phase 1.11.7 — Reject Quote Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { rejectQuoteSchema } from "./quote.schemas";
import {
    QuoteNotFoundError,
    QuoteStatusConflictError,
    MissingRejectionReasonError,
} from "./quoteErrors";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { QuoteReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

/**
 * Transitions a Quote from PENDING_APPROVAL to REJECTED status with mandatory reason.
 */
export async function rejectQuote(
    workspaceId: string,
    quoteId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<QuoteReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.reject
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_REJECT);

    // 3. VALIDATION
    let data;
    try {
        data = rejectQuoteSchema.parse(input);
    } catch (err) {
        throw new MissingRejectionReasonError();
    }

    if (!data.rejectionReason || data.rejectionReason.trim().length === 0) {
        throw new MissingRejectionReasonError();
    }

    // 4. RESOLUTION & INVARIANTS
    const quote = await prisma.quote.findFirst({
        where: {
            id: quoteId,
            workspaceId,
        },
        include: {
            customer: true,
            location: true,
            lineItems: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!quote) {
        throw new QuoteNotFoundError();
    }

    // Lifecycle Guard: Only PENDING_APPROVAL quotes can be rejected
    if (quote.status !== "PENDING_APPROVAL") {
        throw new QuoteStatusConflictError(
            `Quotes in ${quote.status} status cannot be rejected. Only PENDING_APPROVAL quotes can be rejected.`,
        );
    }

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction)
    const rejectedAt = new Date();
    const rejectionReason = data.rejectionReason.trim();

    const updatedQuote = await prisma.$transaction(async (tx) => {
        const resultQuote = await tx.quote.update({
            where: { id: quoteId },
            data: {
                status: "REJECTED",
                rejectedAt,
                rejectionReason,
            },
            include: {
                customer: true,
                location: true,
                lineItems: {
                    orderBy: { sortOrder: "asc" },
                },
            },
        });

        await tx.quoteHistory.create({
            data: {
                quoteId,
                workspaceId,
                eventType: "REJECTED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "status",
                oldValue: "PENDING_APPROVAL",
                newValue: "REJECTED",
                metadata: {
                    rejectionReason,
                    rejectedAt: rejectedAt.toISOString(),
                },
            },
        });

        // Phase 1.13.9: Emit QUOTE_REJECTED in same transaction
        await emitNotificationEvent(tx, {
            workspaceId,
            eventType: NotificationEventType.QUOTE_REJECTED,
            sourceEntity: "Quote",
            sourceId: quote.id,
            actorMemberId: authContext.membership.id,
            payload: {
                quoteId: quote.id,
                quoteNumber: quote.quoteNumber,
                title: quote.title,
                customerId: quote.customerId,
                customerName: quote.customer?.name,
                rejectedAt: rejectedAt.toISOString(),
                rejectionReason,
            },
        });

        return resultQuote;
    });

    return mapQuoteToReadModel(updatedQuote);
}
