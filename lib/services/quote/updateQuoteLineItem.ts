/**
 * Phase 1.11.6 — Update Quote Line Item Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateQuoteLineItemSchema } from "./quote.schemas";
import {
    QuoteNotFoundError,
    QuoteLineItemNotFoundError,
    QuoteStatusConflictError,
    InvalidQuoteCalculationError,
} from "./quoteErrors";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import { PartNotFoundError } from "@/lib/services/inventory/part/partErrors";
import {
    resolveWorkTypeSnapshot,
    resolvePartSnapshot,
} from "./quotePricingSnapshots";
import { calculateQuoteTotals } from "./quoteCalculationEngine";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { QuoteReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Updates a line item within a Quote in DRAFT status.
 * Recalculates full quote totals across all lines and writes an atomic audit history record.
 */
export async function updateQuoteLineItem(
    workspaceId: string,
    quoteId: string,
    lineItemId: string,
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
        data = updateQuoteLineItemSchema.parse(input);
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

    // Lifecycle Guard: Only DRAFT quotes permit line item updates
    if (quote.status !== "DRAFT") {
        throw new QuoteStatusConflictError(
            `Quotes in ${quote.status} status cannot be edited. Only DRAFT quotes can be modified.`,
        );
    }

    // Tenant-scoped line item lookup — verify the line item belongs to this quote
    const existingLine = quote.lineItems.find((l) => l.id === lineItemId);
    if (!existingLine) {
        throw new QuoteLineItemNotFoundError();
    }

    // Merged quantities & Step 1 negative subtotal check
    const mergedQuantity =
        data.quantity !== undefined
            ? new Prisma.Decimal(data.quantity)
            : existingLine.quantity;
    const mergedUnitPrice =
        data.unitPrice !== undefined
            ? new Prisma.Decimal(data.unitPrice)
            : existingLine.unitPrice;
    const mergedDiscountAmount =
        data.discountAmount !== undefined
            ? new Prisma.Decimal(data.discountAmount)
            : existingLine.discountAmount;

    const baseSubtotal = mergedQuantity.mul(mergedUnitPrice).sub(mergedDiscountAmount);
    if (baseSubtotal.isNegative()) {
        throw new InvalidQuoteCalculationError(
            `Invalid quote calculation: line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative.`,
        );
    }

    // WorkType snapshot resolution
    let resolvedWorkTypeName = existingLine.workTypeName;
    let resolvedWorkTypeCode = existingLine.workTypeCode;
    if (data.workTypeId !== undefined) {
        if (data.workTypeId !== null) {
            const wtSnapshot = await resolveWorkTypeSnapshot(workspaceId, data.workTypeId);
            if (!wtSnapshot) {
                throw new WorkTypeNotFoundError();
            }
            resolvedWorkTypeName = wtSnapshot.workTypeName;
            resolvedWorkTypeCode = wtSnapshot.workTypeCode;
        } else {
            resolvedWorkTypeName = null;
            resolvedWorkTypeCode = null;
        }
    }

    // Part snapshot resolution
    let resolvedPartName = existingLine.partName;
    let resolvedPartSku = existingLine.partSku;
    let resolvedPartUom = existingLine.partUnitOfMeasure;
    let resolvedPartCost: Prisma.Decimal | null | undefined = undefined;

    if (data.partId !== undefined) {
        if (data.partId !== null) {
            const partSnapshot = await resolvePartSnapshot(workspaceId, data.partId);
            if (!partSnapshot) {
                throw new PartNotFoundError();
            }
            resolvedPartName = partSnapshot.partName;
            resolvedPartSku = partSnapshot.partSku;
            resolvedPartUom = partSnapshot.partUnitOfMeasure;
            if (data.unitCost === undefined && partSnapshot.unitCost !== null) {
                resolvedPartCost = partSnapshot.unitCost;
            }
        } else {
            resolvedPartName = null;
            resolvedPartSku = null;
            resolvedPartUom = null;
        }
    }

    const effectiveUnitCost =
        data.unitCost !== undefined
            ? data.unitCost !== null
                ? new Prisma.Decimal(data.unitCost)
                : null
            : resolvedPartCost !== undefined
            ? resolvedPartCost
            : existingLine.unitCost;

    const effectiveTaxRate =
        data.taxRate !== undefined
            ? data.taxRate !== null
                ? new Prisma.Decimal(data.taxRate)
                : null
            : existingLine.taxRate;

    const effectiveLineItemType =
        data.lineItemType !== undefined
            ? data.lineItemType
            : data.workTypeId && !data.partId && existingLine.lineItemType === "CUSTOM"
            ? "LABOR"
            : data.partId && !data.workTypeId && existingLine.lineItemType === "CUSTOM"
            ? "PART"
            : existingLine.lineItemType;

    const effectiveName =
        data.name !== undefined && data.name.trim().length > 0
            ? data.name.trim()
            : data.workTypeId && resolvedWorkTypeName
            ? resolvedWorkTypeName
            : data.partId && resolvedPartName
            ? resolvedPartName
            : existingLine.name;

    const effectiveSortOrder =
        data.sortOrder !== undefined ? data.sortOrder : existingLine.sortOrder;

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction)
    const updatedQuote = await prisma.$transaction(async (tx) => {
        // 1. Prepare all lines with updated values for full recalculation
        const allLines = quote.lineItems.map((l) => {
            if (l.id === lineItemId) {
                return {
                    id: l.id,
                    sortOrder: effectiveSortOrder,
                    quantity: mergedQuantity,
                    unitPrice: mergedUnitPrice,
                    unitCost: effectiveUnitCost,
                    discountAmount: mergedDiscountAmount,
                    taxRate: effectiveTaxRate,
                    name: effectiveName,
                };
            }
            return {
                id: l.id,
                sortOrder: l.sortOrder,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                unitCost: l.unitCost,
                discountAmount: l.discountAmount,
                taxRate: l.taxRate,
                name: l.name,
            };
        }).sort((a, b) => a.sortOrder - b.sortOrder);

        // 2. Recalculate full quote totals
        const computed = calculateQuoteTotals(
            {
                discountType: quote.discountType,
                discountValue: quote.discountValue,
                taxRate: quote.taxRate,
            },
            allLines,
        );

        // 3. Update the targeted line item
        await tx.quoteLineItem.update({
            where: { id: lineItemId },
            data: {
                lineItemType: effectiveLineItemType,
                workTypeId: data.workTypeId !== undefined ? data.workTypeId : existingLine.workTypeId,
                partId: data.partId !== undefined ? data.partId : existingLine.partId,
                name: effectiveName,
                description: data.description !== undefined ? data.description : existingLine.description,
                workTypeName: resolvedWorkTypeName,
                workTypeCode: resolvedWorkTypeCode,
                partName: resolvedPartName,
                partSku: resolvedPartSku,
                partUnitOfMeasure: resolvedPartUom,
                quantity: mergedQuantity,
                unitPrice: mergedUnitPrice,
                unitCost: effectiveUnitCost,
                discountAmount: computed.lineItems.find((l) => l.id === lineItemId)?.lineDiscountAmount ?? mergedDiscountAmount,
                subtotal: computed.lineItems.find((l) => l.id === lineItemId)?.lineBaseSubtotal ?? baseSubtotal,
                taxRate: computed.lineItems.find((l) => l.id === lineItemId)?.taxRate ?? (effectiveTaxRate ?? quote.taxRate),
                taxAmount: computed.lineItems.find((l) => l.id === lineItemId)?.taxAmount ?? new Prisma.Decimal("0.00"),
                total: computed.lineItems.find((l) => l.id === lineItemId)?.total ?? new Prisma.Decimal("0.00"),
                sortOrder: effectiveSortOrder,
            },
        });

        // 4. Update all other line items with their newly allocated amounts
        for (const computedLine of computed.lineItems) {
            if (computedLine.id && computedLine.id !== lineItemId) {
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
                eventType: "LINE_ITEM_UPDATED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "lineItems",
                oldValue: JSON.stringify({
                    lineItemId: existingLine.id,
                    name: existingLine.name,
                    quantity: existingLine.quantity.toString(),
                    unitPrice: existingLine.unitPrice.toString(),
                    discountAmount: existingLine.discountAmount.toString(),
                    total: existingLine.total.toString(),
                }),
                newValue: JSON.stringify({
                    lineItemId: existingLine.id,
                    name: effectiveName,
                    quantity: mergedQuantity.toString(),
                    unitPrice: mergedUnitPrice.toString(),
                    discountAmount: mergedDiscountAmount.toString(),
                    total: computed.lineItems.find((l) => l.id === lineItemId)?.total.toString(),
                }),
                metadata: {
                    lineItemId: existingLine.id,
                    updatedFields: Object.keys(data),
                },
            },
        });

        return resultQuote;
    });

    return mapQuoteToReadModel(updatedQuote);
}
