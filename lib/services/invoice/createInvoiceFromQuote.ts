/**
 * Phase 1.12.8 — Create Invoice From Quote Adapter
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createInvoiceFromQuoteSchema } from "./invoice.schemas";
import {
    SourceEntityNotEligibleError,
} from "./invoiceErrors";
import { QuoteNotFoundError } from "@/lib/services/quote/quoteErrors";
import { snapshotLineItemsFromQuote } from "./invoiceSnapshots";
import { calculateInvoiceTotals } from "./invoiceCalculationEngine";
import { mapInvoiceToReadModel } from "./invoiceMappers";
import type { InvoiceReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

/**
 * Creates an invoice in DRAFT status converted from an APPROVED or CONVERTED Quote.
 * Line items are deep-copied into independent InvoiceLineItem records with frozen snapshots.
 */
export async function createInvoiceFromQuote(
    workspaceId: string,
    quoteId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<InvoiceReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.create
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_CREATE);

    // 3. VALIDATION
    const data = createInvoiceFromQuoteSchema.parse(input ?? {});

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
            customer: true,
            location: true,
        },
    });

    if (!quote) {
        throw new QuoteNotFoundError();
    }

    // Eligibility Guard: Quote must be APPROVED or CONVERTED
    if (quote.status !== "APPROVED" && quote.status !== "CONVERTED") {
        throw new SourceEntityNotEligibleError(
            `Quote is in ${quote.status} status and is not eligible for invoicing. Only APPROVED or CONVERTED quotes can be converted into invoices.`,
        );
    }

    // Tenant Workspace currency snapshot
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { defaultCurrencyCode: true },
    });
    const currencyCode = quote.currencyCode || workspace?.defaultCurrencyCode || "USD";

    // Cross-Entity link resolution (1.12.1 §2.1 canonical rule)
    const resolvedQuoteId = quote.id;
    const resolvedWorkOrderId = quote.convertedWorkOrderId ?? null;

    const issueDate = data.issueDate ? new Date(data.issueDate) : new Date();
    const dueDate = new Date(data.dueDate);

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction with Concurrency Retry)
    const MAX_NUMBER_RETRIES = 5;
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
        try {
            const createdInvoice = await runTx(async (tx) => {
                // A. Sequential Invoice Number Generation (INV-YYYY-XXXXXX)
                const year = issueDate.getFullYear();
                const prefix = `INV-${year}-`;

                const lastInvoice = await tx.invoice.findFirst({
                    where: {
                        workspaceId,
                        invoiceNumber: { startsWith: prefix },
                    },
                    orderBy: { invoiceNumber: "desc" },
                    select: { invoiceNumber: true },
                });

                let nextSeq = 1;
                if (lastInvoice?.invoiceNumber) {
                    const parts = lastInvoice.invoiceNumber.split("-");
                    const seqStr = parts[parts.length - 1];
                    const parsed = parseInt(seqStr, 10);
                    if (!isNaN(parsed)) {
                        nextSeq = parsed + 1;
                    }
                }
                const invoiceNumber = `${prefix}${String(nextSeq).padStart(6, "0")}`;

                // B. Create Invoice Header
                const invoice = await tx.invoice.create({
                    data: {
                        workspaceId,
                        invoiceNumber,
                        customerId: quote.customerId,
                        locationId: quote.locationId ?? null,
                        quoteId: resolvedQuoteId,
                        workOrderId: resolvedWorkOrderId,
                        status: "DRAFT",
                        title: data.title ?? quote.title ?? `Invoice for Quote ${quote.quoteNumber}`,
                        notes: data.notes ?? quote.description ?? null,
                        internalNotes: data.internalNotes ?? quote.internalNotes ?? null,
                        termsAndConditions: data.termsAndConditions ?? quote.termsAndConditions ?? null,
                        currencyCode,
                        issueDate,
                        dueDate,
                        subtotal: new Prisma.Decimal("0.00"),
                        discountType: quote.discountType,
                        discountValue: quote.discountValue,
                        discountAmount: new Prisma.Decimal("0.00"),
                        taxRate: quote.taxRate,
                        taxAmount: new Prisma.Decimal("0.00"),
                        total: new Prisma.Decimal("0.00"),
                        amountPaid: new Prisma.Decimal("0.00"),
                        amountDue: new Prisma.Decimal("0.00"),
                    },
                });

                // C. Snapshot Line Items from Quote
                const snapshottedLines = snapshotLineItemsFromQuote(quote.lineItems);

                const createdLineItems: any[] = [];
                for (const line of snapshottedLines) {
                    const createdLine = await tx.invoiceLineItem.create({
                        data: {
                            invoiceId: invoice.id,
                            workspaceId,
                            lineItemType: line.lineItemType,
                            workTypeId: line.workTypeId,
                            partId: line.partId,
                            name: line.name,
                            description: line.description,
                            workTypeName: line.workTypeName,
                            workTypeCode: line.workTypeCode,
                            partName: line.partName,
                            partSku: line.partSku,
                            partUnitOfMeasure: line.partUnitOfMeasure,
                            quantity: line.quantity,
                            unitPrice: line.unitPrice,
                            unitCost: line.unitCost,
                            discountAmount: line.discountAmount,
                            subtotal: new Prisma.Decimal("0.00"),
                            taxRate: line.taxRate,
                            taxAmount: new Prisma.Decimal("0.00"),
                            total: new Prisma.Decimal("0.00"),
                            sortOrder: line.sortOrder,
                        },
                    });
                    createdLineItems.push(createdLine);
                }

                // D. Calculation Engine Execution
                const calculationInputLines = createdLineItems.map((l) => ({
                    id: l.id,
                    sortOrder: l.sortOrder,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    unitCost: l.unitCost,
                    discountAmount: l.discountAmount,
                    taxRate: l.taxRate,
                    name: l.name,
                }));

                const computed = calculateInvoiceTotals(
                    {
                        discountType: quote.discountType,
                        discountValue: quote.discountValue,
                        taxRate: quote.taxRate,
                    },
                    calculationInputLines,
                    [],
                );

                // E. Persist Line Item Calculations
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

                // F. Update Invoice Header Totals
                const finalInvoice = await tx.invoice.update({
                    where: { id: invoice.id },
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
                        quote: true,
                        workOrder: true,
                        lineItems: {
                            orderBy: { sortOrder: "asc" },
                        },
                        payments: true,
                    },
                });

                // G. Audit Trail Record
                await tx.invoiceHistory.create({
                    data: {
                        invoiceId: invoice.id,
                        workspaceId,
                        eventType: "CREATED",
                        actorMemberId: authContext.membership.id,
                        actorName: authContext.user?.name ?? null,
                        field: "status",
                        oldValue: null,
                        newValue: "DRAFT",
                        metadata: {
                            source: "QUOTE",
                            sourceQuoteId: quote.id,
                            sourceQuoteNumber: quote.quoteNumber,
                            lineItemCount: snapshottedLines.length,
                            total: computed.total.toString(),
                        },
                    },
                });

                // Phase 1.13.9: Emit INVOICE_CREATED in same transaction
                await emitNotificationEvent(tx, {
                    workspaceId,
                    eventType: NotificationEventType.INVOICE_CREATED,
                    sourceEntity: "Invoice",
                    sourceId: finalInvoice?.id || invoice.id,
                    actorMemberId: authContext.membership.id,
                    payload: {
                        invoiceId: finalInvoice?.id || invoice.id,
                        invoiceNumber: finalInvoice?.invoiceNumber || invoice.invoiceNumber || "INV-UNKNOWN",
                        title: finalInvoice?.title || invoice.title || "Invoice",
                        customerId: finalInvoice?.customerId || invoice.customerId || quote.customerId || "customer_unknown",
                        customerName: finalInvoice?.customer?.name || quote.customer?.name,
                        totalAmount:
                            typeof finalInvoice?.total === "object" && (finalInvoice.total as any)?.toFixed
                                ? (finalInvoice.total as any).toFixed(2)
                                : String(finalInvoice?.total ?? invoice.total ?? computed.total ?? "0.00"),
                        dueDate:
                            finalInvoice?.dueDate instanceof Date
                                ? finalInvoice.dueDate.toISOString()
                                : finalInvoice?.dueDate
                                  ? new Date(finalInvoice.dueDate).toISOString()
                                  : invoice.dueDate instanceof Date
                                    ? invoice.dueDate.toISOString()
                                    : new Date().toISOString(),
                    },
                });

                return finalInvoice;
            });

            return mapInvoiceToReadModel(createdInvoice);
        } catch (err: any) {
            lastError = err;
            const isUniqueConstraint =
                err?.code === "P2002" ||
                err?.message?.includes("Unique constraint") ||
                (err?.meta?.target && Array.isArray(err.meta.target) && err.meta.target.includes("invoiceNumber"));

            if (isUniqueConstraint && attempt < MAX_NUMBER_RETRIES - 1) {
                continue;
            }
            throw err;
        }
    }

    throw lastError;
}
