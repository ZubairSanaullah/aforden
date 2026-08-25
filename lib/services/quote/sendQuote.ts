/**
 * Phase 1.11.7 — Send Quote Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { sendQuoteSchema } from "./quote.schemas";
import {
    QuoteNotFoundError,
    QuoteStatusConflictError,
    QuoteEmptyLineItemsError,
    QuoteExpiredError,
} from "./quoteErrors";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { QuoteReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

/**
 * Transitions a Quote from DRAFT to PENDING_APPROVAL status.
 * Enforces non-empty line items and future expiration date.
 */
export async function sendQuote(
    workspaceId: string,
    quoteId: string,
    input?: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<QuoteReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.send
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_SEND);

    // 3. VALIDATION
    const data = sendQuoteSchema.parse(input ?? {});

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

    // Lifecycle Guard: Only DRAFT quotes can be sent
    if (quote.status !== "DRAFT") {
        throw new QuoteStatusConflictError(
            `Quotes in ${quote.status} status cannot be sent. Only DRAFT quotes can be sent.`,
        );
    }

    // Line Items Guard: Must have at least 1 line item
    if (!quote.lineItems || quote.lineItems.length === 0) {
        throw new QuoteEmptyLineItemsError(
            "Quote must have at least one line item before it can be sent.",
        );
    }

    // Expiration Date Guard: validUntil must be present and in the future
    if (!quote.validUntil) {
        throw new Error(
            "Quote cannot be sent without a valid expiration date (validUntil).",
        );
    }

    const now = new Date();
    if (new Date(quote.validUntil) <= now) {
        throw new QuoteExpiredError(
            "Quote validity period has already expired and cannot be sent.",
        );
    }

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction)
    const sentAt = new Date();

    const updatedQuote = await prisma.$transaction(async (tx) => {
        const resultQuote = await tx.quote.update({
            where: { id: quoteId },
            data: {
                status: "PENDING_APPROVAL",
                sentAt,
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
                eventType: "SENT",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "status",
                oldValue: "DRAFT",
                newValue: "PENDING_APPROVAL",
                metadata: {
                    notes: data.notes ?? null,
                    sentAt: sentAt.toISOString(),
                    validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
                    total: quote.total.toString(),
                    lineItemCount: quote.lineItems.length,
                },
            },
        });

        // Phase 1.13.9: Emit QUOTE_SENT in same transaction
        await emitNotificationEvent(tx, {
            workspaceId,
            eventType: NotificationEventType.QUOTE_SENT,
            sourceEntity: "Quote",
            sourceId: quote.id,
            actorMemberId: authContext.membership.id,
            payload: {
                quoteId: quote.id,
                quoteNumber: quote.quoteNumber,
                title: quote.title,
                customerId: quote.customerId,
                customerName: quote.customer?.name,
                customerEmail: quote.customer?.email ?? undefined,
                totalAmount:
                    typeof quote.total === "object" && (quote.total as any)?.toFixed
                        ? (quote.total as any).toFixed(2)
                        : String(quote.total ?? "0.00"),
                expirationDate:
                    quote.validUntil instanceof Date
                        ? quote.validUntil.toISOString()
                        : quote.validUntil
                          ? new Date(quote.validUntil).toISOString()
                          : new Date().toISOString(),
            },
        });

        return resultQuote;
    });

    return mapQuoteToReadModel(updatedQuote);
}
