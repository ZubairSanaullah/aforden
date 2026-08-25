/**
 * Phase 1.11.7 — Approve Quote Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { approveQuoteSchema } from "./quote.schemas";
import {
    QuoteNotFoundError,
    QuoteStatusConflictError,
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
 * Transitions a Quote from PENDING_APPROVAL to APPROVED status.
 * Rejects expired quotes and logs customer approval details.
 */
export async function approveQuote(
    workspaceId: string,
    quoteId: string,
    input?: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<QuoteReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.approve
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_APPROVE);

    // 3. VALIDATION
    const data = approveQuoteSchema.parse(input ?? {});

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

    // Lifecycle Guard: Only PENDING_APPROVAL quotes can be approved
    if (quote.status !== "PENDING_APPROVAL") {
        throw new QuoteStatusConflictError(
            `Quotes in ${quote.status} status cannot be approved. Only PENDING_APPROVAL quotes can be approved.`,
        );
    }

    // Expiration Guard: Reject if validity period has passed
    const now = new Date();
    if (quote.validUntil && new Date(quote.validUntil) < now) {
        throw new QuoteExpiredError(
            "Quote has expired and cannot be approved without revision.",
        );
    }

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction)
    const approvedAt = new Date();
    const approvedByCustomerName = data.approvedByCustomerName ?? null;

    const updatedQuote = await prisma.$transaction(async (tx) => {
        const resultQuote = await tx.quote.update({
            where: { id: quoteId },
            data: {
                status: "APPROVED",
                approvedAt,
                approvedByCustomerName,
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
                eventType: "APPROVED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "status",
                oldValue: "PENDING_APPROVAL",
                newValue: "APPROVED",
                metadata: {
                    approvedByCustomerName,
                    notes: data.notes ?? null,
                    approvedAt: approvedAt.toISOString(),
                    total: quote.total.toString(),
                },
            },
        });

        // Phase 1.13.9: Emit QUOTE_ACCEPTED in same transaction
        await emitNotificationEvent(tx, {
            workspaceId,
            eventType: NotificationEventType.QUOTE_ACCEPTED,
            sourceEntity: "Quote",
            sourceId: quote.id,
            actorMemberId: authContext.membership.id,
            payload: {
                quoteId: quote.id,
                quoteNumber: quote.quoteNumber,
                title: quote.title,
                customerId: quote.customerId,
                customerName: quote.customer?.name,
                totalAmount:
                    typeof quote.total === "object" && (quote.total as any)?.toFixed
                        ? (quote.total as any).toFixed(2)
                        : String(quote.total ?? "0.00"),
                acceptedAt: approvedAt.toISOString(),
                approvedByCustomer: approvedByCustomerName ?? undefined,
            },
        });

        return resultQuote;
    });

    return mapQuoteToReadModel(updatedQuote);
}
