/**
 * Phase 1.11.6 — Reorder Quote Line Items Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    QuoteNotFoundError,
    QuoteLineItemNotFoundError,
    QuoteStatusConflictError,
} from "./quoteErrors";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { QuoteReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Reorders line items within a Quote in DRAFT status.
 * Updates sortOrder for all line items atomically and records an audit history entry.
 */
export async function reorderQuoteLineItems(
    workspaceId: string,
    quoteId: string,
    orderedLineItemIds: string[],
    actor?: WorkspaceAuthorizationContext,
): Promise<QuoteReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.update
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_UPDATE);

    // 3. RESOLUTION & INVARIANTS
    const quote = await prisma.quote.findFirst({
        where: {
            id: quoteId,
            workspaceId,
        },
        include: {
            lineItems: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!quote) {
        throw new QuoteNotFoundError();
    }

    // Lifecycle Guard: Only DRAFT quotes permit reordering
    if (quote.status !== "DRAFT") {
        throw new QuoteStatusConflictError(
            `Quotes in ${quote.status} status cannot be edited. Only DRAFT quotes can be modified.`,
        );
    }

    // 4. VALIDATION OF ORDERED IDS
    if (!Array.isArray(orderedLineItemIds)) {
        throw new Error("Invalid line item order: orderedLineItemIds must be an array of IDs.");
    }

    if (orderedLineItemIds.length !== quote.lineItems.length) {
        throw new Error(
            `Invalid line item order: expected ${quote.lineItems.length} IDs, received ${orderedLineItemIds.length}.`,
        );
    }

    const currentIdSet = new Set(quote.lineItems.map((l) => l.id));
    const uniqueIncomingIds = new Set(orderedLineItemIds);

    if (uniqueIncomingIds.size !== orderedLineItemIds.length) {
        throw new Error("Invalid line item order: duplicate line item IDs provided.");
    }

    for (const id of orderedLineItemIds) {
        if (!currentIdSet.has(id)) {
            throw new QuoteLineItemNotFoundError(
                `Line item ${id} does not belong to this quote or workspace.`,
            );
        }
    }

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction)
    const updatedQuote = await prisma.$transaction(async (tx) => {
        // 1. Update sortOrder for each line item
        for (let i = 0; i < orderedLineItemIds.length; i++) {
            const lineId = orderedLineItemIds[i];
            await tx.quoteLineItem.update({
                where: { id: lineId },
                data: { sortOrder: i },
            });
        }

        // 2. Audit Trail Entry
        await tx.quoteHistory.create({
            data: {
                quoteId,
                workspaceId,
                eventType: "LINE_ITEM_UPDATED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "sortOrder",
                oldValue: JSON.stringify(
                    quote.lineItems.map((l) => ({ id: l.id, sortOrder: l.sortOrder })),
                ),
                newValue: JSON.stringify(
                    orderedLineItemIds.map((id, index) => ({ id, sortOrder: index })),
                ),
                metadata: {
                    action: "REORDER",
                    orderedLineItemIds,
                },
            },
        });

        // 3. Re-fetch updated quote
        return tx.quote.findUniqueOrThrow({
            where: { id: quoteId },
            include: {
                customer: true,
                location: true,
                lineItems: {
                    orderBy: { sortOrder: "asc" },
                },
            },
        });
    });

    return mapQuoteToReadModel(updatedQuote);
}
