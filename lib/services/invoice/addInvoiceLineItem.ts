/**
 * Phase 1.12.6 — Add Invoice Line Item Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createInvoiceLineItemSchema } from "./invoice.schemas";
import {
    InvoiceNotFoundError,
    InvoiceStatusConflictError,
    InvalidInvoiceCalculationError,
} from "./invoiceErrors";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import { PartNotFoundError } from "@/lib/services/inventory/part/partErrors";
import {
    resolveInvoiceWorkTypeSnapshot,
    resolveInvoicePartSnapshot,
    resolveStandaloneLineItemSnapshot,
} from "./invoiceSnapshots";
import { calculateInvoiceTotals } from "./invoiceCalculationEngine";
import { mapInvoiceToReadModel } from "./invoiceMappers";
import type { InvoiceReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Adds a new line item to an Invoice in DRAFT status within an authorized workspace.
 * Recalculates full invoice totals and writes an atomic audit history record.
 */
export async function addInvoiceLineItem(
    workspaceId: string,
    invoiceId: string,
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
        data = createInvoiceLineItemSchema.parse(input);
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

    // Lifecycle Guard: Only DRAFT invoices permit line item additions
    if (invoice.status !== "DRAFT") {
        throw new InvoiceStatusConflictError(
            `Invoices in ${invoice.status} status cannot be edited. Only DRAFT invoices can be modified.`,
        );
    }

    // Tenant-scoped catalog verification
    if (data.workTypeId) {
        const wtSnapshot = await resolveInvoiceWorkTypeSnapshot(workspaceId, data.workTypeId);
        if (!wtSnapshot) {
            throw new WorkTypeNotFoundError();
        }
    }

    if (data.partId) {
        const partSnapshot = await resolveInvoicePartSnapshot(workspaceId, data.partId);
        if (!partSnapshot) {
            throw new PartNotFoundError();
        }
    }

    // Resolve snapshot fields and defaults
    const snapshot = await resolveStandaloneLineItemSnapshot(workspaceId, data);

    // Determine sortOrder (append to end if omitted)
    const explicitSortOrder =
        (input as any)?.sortOrder !== undefined ? data.sortOrder : undefined;
    let sortOrder = explicitSortOrder;
    if (sortOrder === undefined) {
        if (invoice.lineItems.length > 0) {
            const maxOrder = Math.max(...invoice.lineItems.map((l) => l.sortOrder));
            sortOrder = maxOrder + 1;
        } else {
            sortOrder = 0;
        }
    }

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction)
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updatedInvoice = await runTx(async (tx) => {
        // 1. Insert new line item
        const createdLineItem = await tx.invoiceLineItem.create({
            data: {
                invoiceId,
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
                taxRate: snapshot.taxRate,
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("0.00"),
                sortOrder,
            },
        });

        // 2. Prepare full line set for recalculation
        const allLines = [
            ...invoice.lineItems.map((l) => ({
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
        const computedCreatedLine = computed.lineItems.find(
            (l) => l.id === createdLineItem.id,
        );
        const lineTotal = computedCreatedLine ? computedCreatedLine.total : createdLineItem.total;

        await tx.invoiceHistory.create({
            data: {
                invoiceId,
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

        return resultInvoice;
    });

    return mapInvoiceToReadModel(updatedInvoice);
}
