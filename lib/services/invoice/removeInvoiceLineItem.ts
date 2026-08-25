/**
 * Phase 1.12.6 — Remove Invoice Line Item Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    InvoiceNotFoundError,
    InvoiceLineItemNotFoundError,
    InvoiceStatusConflictError,
} from "./invoiceErrors";
import { calculateInvoiceTotals } from "./invoiceCalculationEngine";
import { mapInvoiceToReadModel } from "./invoiceMappers";
import type { InvoiceReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Removes a line item from an Invoice in DRAFT status.
 * Recalculates full invoice totals across remaining line items (handles 0 items case gracefully)
 * and writes an atomic audit history record.
 */
export async function removeInvoiceLineItem(
    workspaceId: string,
    invoiceId: string,
    lineItemId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<InvoiceReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.update
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_UPDATE);

    // 3. RESOLUTION & INVARIANTS
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

    // Lifecycle Guard: Only DRAFT invoices permit line item removal
    if (invoice.status !== "DRAFT") {
        throw new InvoiceStatusConflictError(
            `Invoices in ${invoice.status} status cannot be edited. Only DRAFT invoices can be modified.`,
        );
    }

    // Tenant-scoped line item lookup — verify line item belongs to this invoice
    const existingLine = invoice.lineItems.find((l) => l.id === lineItemId);
    if (!existingLine) {
        throw new InvoiceLineItemNotFoundError();
    }

    // 4. BUSINESS LOGIC & 5. PERSISTENCE (Atomic Transaction)
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updatedInvoice = await runTx(async (tx) => {
        // 1. Delete line item
        await tx.invoiceLineItem.delete({
            where: { id: lineItemId },
        });

        // 2. Prepare remaining line items for recalculation
        const remainingLines = invoice.lineItems.filter((l) => l.id !== lineItemId);

        // 3. Recalculate full invoice totals across remaining items
        const computed = calculateInvoiceTotals(
            {
                discountType: invoice.discountType,
                discountValue: invoice.discountValue,
                taxRate: invoice.taxRate,
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
            invoice.payments.map((p) => ({
                id: p.id,
                amount: p.amount,
                status: p.status,
            })),
        );

        // 4. Update remaining line items with redistributed header discount and taxes
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
                eventType: "LINE_ITEM_REMOVED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "lineItems",
                oldValue: lineItemId,
                newValue: null,
                metadata: {
                    lineItemId: existingLine.id,
                    name: existingLine.name,
                    amount: existingLine.total.toString(),
                    quantity: existingLine.quantity.toString(),
                    unitPrice: existingLine.unitPrice.toString(),
                },
            },
        });

        return resultInvoice;
    });

    return mapInvoiceToReadModel(updatedInvoice);
}
