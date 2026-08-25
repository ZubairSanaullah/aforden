/**
 * Phase 1.12.6 — Update Invoice Line Item Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateInvoiceLineItemSchema } from "./invoice.schemas";
import {
    InvoiceNotFoundError,
    InvoiceLineItemNotFoundError,
    InvoiceStatusConflictError,
    InvalidInvoiceCalculationError,
} from "./invoiceErrors";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import { PartNotFoundError } from "@/lib/services/inventory/part/partErrors";
import {
    resolveInvoiceWorkTypeSnapshot,
    resolveInvoicePartSnapshot,
} from "./invoiceSnapshots";
import { calculateInvoiceTotals } from "./invoiceCalculationEngine";
import { mapInvoiceToReadModel } from "./invoiceMappers";
import type { InvoiceReadModel, InvoiceLineItemType } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Updates a line item within an Invoice in DRAFT status.
 * Recalculates full invoice totals across all lines and writes an atomic audit history record.
 */
export async function updateInvoiceLineItem(
    workspaceId: string,
    invoiceId: string,
    lineItemId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<InvoiceReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.update
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_UPDATE);

    // 3. VALIDATION
    let data;
    try {
        data = updateInvoiceLineItemSchema.parse(input);
    } catch (err: any) {
        // Step 1 Negative subtotal guard refinement
        const rawQty = Number((input as any)?.quantity);
        const rawPrice = Number((input as any)?.unitPrice);
        const rawDiscount = Number((input as any)?.discountAmount ?? 0);
        if (!isNaN(rawQty) && !isNaN(rawPrice) && (rawQty * rawPrice) - rawDiscount < 0) {
            throw new InvalidInvoiceCalculationError();
        }
        throw err;
    }

    // 4. RESOLUTION & INVARIANTS
    const invoice = await prisma.invoice.findFirst({
        where: {
            id: invoiceId,
            workspaceId,
        },
        include: {
            lineItems: {
                orderBy: { sortOrder: "asc" },
            },
            payments: true,
        },
    });

    if (!invoice) {
        throw new InvoiceNotFoundError();
    }

    // Lifecycle Guard: Only DRAFT invoices permit line item updates
    if (invoice.status !== "DRAFT") {
        throw new InvoiceStatusConflictError(
            `Invoices in ${invoice.status} status cannot be edited. Only DRAFT invoices can be modified.`,
        );
    }

    // Tenant-scoped line item lookup — verify the line item belongs to this invoice
    const existingLine = invoice.lineItems.find((l) => l.id === lineItemId);
    if (!existingLine) {
        throw new InvoiceLineItemNotFoundError();
    }

    // Merged quantities & Step 1 negative subtotal check
    const mergedQuantity =
        data.quantity !== undefined
            ? new Prisma.Decimal(String(data.quantity))
            : existingLine.quantity;
    const mergedUnitPrice =
        data.unitPrice !== undefined
            ? new Prisma.Decimal(String(data.unitPrice))
            : existingLine.unitPrice;
    const mergedDiscountAmount =
        data.discountAmount !== undefined
            ? new Prisma.Decimal(String(data.discountAmount))
            : existingLine.discountAmount;

    const baseSubtotal = mergedQuantity.mul(mergedUnitPrice).sub(mergedDiscountAmount);
    if (baseSubtotal.isNegative()) {
        throw new InvalidInvoiceCalculationError(
            `Invalid invoice calculation: line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative.`,
        );
    }

    // WorkType snapshot resolution
    let resolvedWorkTypeName = existingLine.workTypeName;
    let resolvedWorkTypeCode = existingLine.workTypeCode;
    if (data.workTypeId !== undefined) {
        if (data.workTypeId !== null) {
            const wtSnapshot = await resolveInvoiceWorkTypeSnapshot(workspaceId, data.workTypeId);
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
    let resolvedPartUnitOfMeasure = existingLine.partUnitOfMeasure;
    let resolvedUnitCost = existingLine.unitCost;
    if (data.partId !== undefined) {
        if (data.partId !== null) {
            const partSnapshot = await resolveInvoicePartSnapshot(workspaceId, data.partId);
            if (!partSnapshot) {
                throw new PartNotFoundError();
            }
            resolvedPartName = partSnapshot.partName;
            resolvedPartSku = partSnapshot.partSku;
            resolvedPartUnitOfMeasure = partSnapshot.partUnitOfMeasure;
            if (data.unitCost === undefined && partSnapshot.unitCost !== null) {
                resolvedUnitCost = partSnapshot.unitCost;
            }
        } else {
            resolvedPartName = null;
            resolvedPartSku = null;
            resolvedPartUnitOfMeasure = null;
        }
    }

    if (data.unitCost !== undefined) {
        resolvedUnitCost = data.unitCost !== null ? new Prisma.Decimal(String(data.unitCost)) : null;
    }

    const mergedLineItemType: InvoiceLineItemType =
        data.lineItemType ??
        (data.workTypeId
            ? "LABOR"
            : data.partId
            ? "PART"
            : (existingLine.lineItemType as InvoiceLineItemType));

    const mergedName =
        data.name !== undefined && data.name.trim().length > 0
            ? data.name.trim()
            : existingLine.name;

    const mergedDescription =
        data.description !== undefined ? data.description : existingLine.description;

    const mergedTaxRate =
        data.taxRate !== undefined && data.taxRate !== null
            ? new Prisma.Decimal(String(data.taxRate))
            : existingLine.taxRate;

    const mergedSortOrder =
        data.sortOrder !== undefined ? data.sortOrder : existingLine.sortOrder;

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction)
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updatedInvoice = await runTx(async (tx) => {
        // 1. Update line item record
        await tx.invoiceLineItem.update({
            where: { id: lineItemId },
            data: {
                lineItemType: mergedLineItemType,
                workTypeId: data.workTypeId !== undefined ? data.workTypeId : existingLine.workTypeId,
                partId: data.partId !== undefined ? data.partId : existingLine.partId,
                name: mergedName,
                description: mergedDescription,
                workTypeName: resolvedWorkTypeName,
                workTypeCode: resolvedWorkTypeCode,
                partName: resolvedPartName,
                partSku: resolvedPartSku,
                partUnitOfMeasure: resolvedPartUnitOfMeasure,
                quantity: mergedQuantity,
                unitPrice: mergedUnitPrice,
                unitCost: resolvedUnitCost,
                discountAmount: mergedDiscountAmount,
                taxRate: mergedTaxRate,
                sortOrder: mergedSortOrder,
            },
        });

        // 2. Prepare full line set for recalculation
        const allLines = invoice.lineItems
            .map((l) => {
                if (l.id === lineItemId) {
                    return {
                        id: l.id,
                        sortOrder: mergedSortOrder,
                        quantity: mergedQuantity,
                        unitPrice: mergedUnitPrice,
                        unitCost: resolvedUnitCost,
                        discountAmount: mergedDiscountAmount,
                        taxRate: mergedTaxRate,
                        name: mergedName,
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
            })
            .sort((a, b) => a.sortOrder - b.sortOrder);

        // 3. Recalculate full invoice totals
        const computed = calculateInvoiceTotals(
            {
                discountType: invoice.discountType,
                discountValue: invoice.discountValue,
                taxRate: invoice.taxRate,
            },
            allLines,
            invoice.payments.map((p) => ({
                id: p.id,
                amount: p.amount,
                status: p.status,
            })),
        );

        // 4. Persist updated line-level calculations across all lines
        for (const computedLine of computed.lineItems) {
            if (computedLine.id) {
                await tx.invoiceLineItem.update({
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

        // 5. Update invoice header totals
        const resultInvoice = await tx.invoice.update({
            where: { id: invoiceId },
            data: {
                subtotal: computed.subtotal,
                discountAmount: computed.discountAmount,
                taxAmount: computed.taxAmount,
                total: computed.total,
                amountPaid: computed.amountPaid,
                amountDue: computed.amountDue,
            },
            include: {
                customer: true,
                location: true,
                lineItems: {
                    orderBy: { sortOrder: "asc" },
                },
                payments: true,
            },
        });

        // 6. Audit Trail Entry
        await tx.invoiceHistory.create({
            data: {
                invoiceId,
                workspaceId,
                eventType: "LINE_ITEM_UPDATED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "lineItems",
                oldValue: JSON.stringify({
                    id: existingLine.id,
                    name: existingLine.name,
                    quantity: existingLine.quantity.toString(),
                    unitPrice: existingLine.unitPrice.toString(),
                    discountAmount: existingLine.discountAmount.toString(),
                    total: existingLine.total.toString(),
                }),
                newValue: JSON.stringify({
                    id: lineItemId,
                    name: mergedName,
                    quantity: mergedQuantity.toString(),
                    unitPrice: mergedUnitPrice.toString(),
                    discountAmount: mergedDiscountAmount.toString(),
                }),
                metadata: {
                    lineItemId,
                    updatedFields: Object.keys(data),
                },
            },
        });

        return resultInvoice;
    });

    return mapInvoiceToReadModel(updatedInvoice);
}
