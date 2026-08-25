/**
 * Phase 1.11.6 — Add Quote Line Item Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createQuoteLineItemSchema } from "./quote.schemas";
import {
    QuoteNotFoundError,
    QuoteStatusConflictError,
    InvalidQuoteCalculationError,
} from "./quoteErrors";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import { PartNotFoundError } from "@/lib/services/inventory/part/partErrors";
import {
    resolveWorkTypeSnapshot,
    resolvePartSnapshot,
    resolveLineItemSnapshot,
} from "./quotePricingSnapshots";
import { calculateQuoteTotals } from "./quoteCalculationEngine";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { QuoteReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Adds a new line item to a Quote in DRAFT status within an authorized workspace.
 * Recalculates full quote totals and writes an atomic audit history record.
 */
export async function addQuoteLineItem(
    workspaceId: string,
    quoteId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<QuoteReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.update
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_UPDATE);

    // 3. VALIDATION
    let data;
    try {
        data = createQuoteLineItemSchema.parse(input);
    } catch (err: any) {
        // Step 1 Negative subtotal guard refinement
        const rawQty = Number((input as any)?.quantity);
        const rawPrice = Number((input as any)?.unitPrice);
        const rawDiscount = Number((input as any)?.discountAmount ?? 0);
        if (!isNaN(rawQty) && !isNaN(rawPrice) && (rawQty * rawPrice) - rawDiscount < 0) {
            throw new InvalidQuoteCalculationError();
        }
        throw err;
    }

    // 4. RESOLUTION & INVARIANTS
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

    // Lifecycle Guard: Only DRAFT quotes permit line item additions
    if (quote.status !== "DRAFT") {
        throw new QuoteStatusConflictError(
            `Quotes in ${quote.status} status cannot be edited. Only DRAFT quotes can be modified.`,
        );
    }

    // Tenant-scoped catalog verification
    if (data.workTypeId) {
        const wtSnapshot = await resolveWorkTypeSnapshot(workspaceId, data.workTypeId);
        if (!wtSnapshot) {
            throw new WorkTypeNotFoundError();
        }
    }

    if (data.partId) {
        const partSnapshot = await resolvePartSnapshot(workspaceId, data.partId);
        if (!partSnapshot) {
            throw new PartNotFoundError();
        }
    }

    // Resolve snapshot fields and defaults
    const snapshot = await resolveLineItemSnapshot(workspaceId, data);

    // Determine sortOrder (append to end if omitted)
    const explicitSortOrder =
        (input as any)?.sortOrder !== undefined ? data.sortOrder : undefined;
    let sortOrder = explicitSortOrder;
    if (sortOrder === undefined) {
        if (quote.lineItems.length > 0) {
            const maxOrder = Math.max(...quote.lineItems.map((l) => l.sortOrder));
            sortOrder = maxOrder + 1;
        } else {
            sortOrder = 0;
        }
    }

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction)
    const updatedQuote = await prisma.$transaction(async (tx) => {
        // 1. Insert new line item
        const createdLineItem = await tx.quoteLineItem.create({
            data: {
                quoteId,
                workspaceId,
                lineItemType: snapshot.lineItemType,
                workTypeId: snapshot.workTypeId,
                partId: snapshot.partId,
                name: snapshot.name,
                description: snapshot.description,
                workTypeName: snapshot.workTypeName,
                workTypeCode: snapshot.workTypeCode,
                partName: snapshot.partName,
                partSku: snapshot.partSku,
                partUnitOfMeasure: snapshot.partUnitOfMeasure,
                quantity: snapshot.quantity,
                unitPrice: snapshot.unitPrice,
                unitCost: snapshot.unitCost,
                discountAmount: snapshot.discountAmount,
                subtotal: new Prisma.Decimal("0.00"),
                taxRate: snapshot.taxRate ?? quote.taxRate,
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("0.00"),
                sortOrder,
            },
        });

        // 2. Prepare full line set for recalculation
        const allLines = [
            ...quote.lineItems.map((l) => ({
                id: l.id,
                sortOrder: l.sortOrder,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                unitCost: l.unitCost,
                discountAmount: l.discountAmount,
                taxRate: l.taxRate,
                name: l.name,
            })),
            {
                id: createdLineItem.id,
                sortOrder: createdLineItem.sortOrder,
                quantity: createdLineItem.quantity,
                unitPrice: createdLineItem.unitPrice,
                unitCost: createdLineItem.unitCost,
                discountAmount: createdLineItem.discountAmount,
                taxRate: createdLineItem.taxRate,
                name: createdLineItem.name,
            },
        ].sort((a, b) => a.sortOrder - b.sortOrder);

        // 3. Recalculate full quote totals
        const computed = calculateQuoteTotals(
            {
                discountType: quote.discountType,
                discountValue: quote.discountValue,
                taxRate: quote.taxRate,
            },
            allLines,
        );

        // 4. Persist updated line-level calculations across all lines
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
        const computedCreatedLine = computed.lineItems.find(
            (l) => l.id === createdLineItem.id,
        );
        const lineTotal = computedCreatedLine ? computedCreatedLine.total : createdLineItem.total;

        await tx.quoteHistory.create({
            data: {
                quoteId,
                workspaceId,
                eventType: "LINE_ITEM_ADDED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "lineItems",
                oldValue: null,
                newValue: createdLineItem.id,
                metadata: {
                    lineItemId: createdLineItem.id,
                    name: createdLineItem.name,
                    lineItemType: createdLineItem.lineItemType,
                    amount: lineTotal.toString(),
                    quantity: createdLineItem.quantity.toString(),
                    unitPrice: createdLineItem.unitPrice.toString(),
                },
            },
        });

        return resultQuote;
    });

    return mapQuoteToReadModel(updatedQuote);
}
