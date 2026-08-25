/**
 * Phase 1.11.6 — Remove Quote Line Item Service
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
import { calculateQuoteTotals } from "./quoteCalculationEngine";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { QuoteReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Removes a line item from a Quote in DRAFT status.
 * Recalculates full quote totals across remaining line items (handles 0 items case gracefully)
 * and writes an atomic audit history record.
 */
export async function removeQuoteLineItem(
    workspaceId: string,
    quoteId: string,
    lineItemId: string,
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

    // Lifecycle Guard: Only DRAFT quotes permit line item removal
    if (quote.status !== "DRAFT") {
        throw new QuoteStatusConflictError(
            `Quotes in ${quote.status} status cannot be edited. Only DRAFT quotes can be modified.`,
        );
    }

    // Tenant-scoped line item lookup — verify line item belongs to this quote
    const existingLine = quote.lineItems.find((l) => l.id === lineItemId);
    if (!existingLine) {
        throw new QuoteLineItemNotFoundError();
    }

    // 4. BUSINESS LOGIC & 5. PERSISTENCE (Atomic Transaction)
    const updatedQuote = await prisma.$transaction(async (tx) => {
        // 1. Delete line item
        await tx.quoteLineItem.delete({
            where: { id: lineItemId },
        });

        // 2. Prepare remaining line items for recalculation
        const remainingLines = quote.lineItems.filter((l) => l.id !== lineItemId);

        // 3. Recalculate full quote totals across remaining items
        const computed = calculateQuoteTotals(
            {
                discountType: quote.discountType,
                discountValue: quote.discountValue,
                taxRate: quote.taxRate,
            },
            remainingLines.map((l) => ({
                id: l.id,
                sortOrder: l.sortOrder,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                unitCost: l.unitCost,
                discountAmount: l.discountAmount,
                taxRate: l.taxRate,
                name: l.name,
            })),
        );

        // 4. Update remaining line items with redistributed header discount and taxes
        for (const computedLine of computed.lineItems) {
            if (computedLine.id) {
                await tx.quoteLineItem.update({
                    where: { id: computedLine.id },
                    data: {
                        discountAmount: computedLine.lineDiscountAmount,
                        subtotal: computedLine.lineBaseSubtotal,
                        taxRate: computedLine.taxRate,
                        taxAmount: computedLine.taxAmount,
                        total: computedLine.total,
                    },
                });
            }
        }

        // 5. Update quote header totals
        const resultQuote = await tx.quote.update({
            where: { id: quoteId },
            data: {
                subtotal: computed.subtotal,
                discountAmount: computed.discountAmount,
                taxAmount: computed.taxAmount,
                total: computed.total,
            },
            include: {
                customer: true,
                location: true,
                lineItems: {
                    orderBy: { sortOrder: "asc" },
                },
            },
        });

        // 6. Audit Trail Entry
        await tx.quoteHistory.create({
            data: {
                quoteId,
                workspaceId,
                eventType: "LINE_ITEM_REMOVED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "lineItems",
                oldValue: existingLine.id,
                newValue: null,
                metadata: {
                    lineItemId: existingLine.id,
                    name: existingLine.name,
                    lineItemType: existingLine.lineItemType,
                    amount: existingLine.total.toString(),
                    quantity: existingLine.quantity.toString(),
                    unitPrice: existingLine.unitPrice.toString(),
                },
            },
        });

        return resultQuote;
    });

    return mapQuoteToReadModel(updatedQuote);
}
