/**
 * Phase 1.12.8 — Create Invoice From WorkOrder Adapter
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createInvoiceFromWorkOrderSchema } from "./invoice.schemas";
import {
    SourceEntityNotEligibleError,
} from "./invoiceErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { snapshotLineItemsFromWorkOrder } from "./invoiceSnapshots";
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
 * Creates an invoice in DRAFT status converted from a COMPLETED WorkOrder.
 * Translates work order operational labor and consumed parts into independent InvoiceLineItem records.
 */
export async function createInvoiceFromWorkOrder(
    workspaceId: string,
    workOrderId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<InvoiceReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.create
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_CREATE);

    // 3. VALIDATION
    const data = createInvoiceFromWorkOrderSchema.parse(input ?? {});

    // 4. RESOLUTION & INVARIANTS
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: workOrderId,
            workspaceId,
        },
        include: {
            customer: true,
            location: true,
            workType: true,
            workOrderParts: {
                include: {
                    part: true,
                },
            },
        },
    });

    if (!workOrder) {
        throw new WorkOrderNotFoundError();
    }

    // Eligibility Guard: WorkOrder must be COMPLETED
    if (workOrder.status !== "COMPLETED") {
        throw new SourceEntityNotEligibleError(
            `WorkOrder is in ${workOrder.status} status and is not eligible for invoicing. Only COMPLETED work orders can be converted into invoices.`,
        );
    }

    // Tenant Workspace currency snapshot
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { defaultCurrencyCode: true },
    });
    const currencyCode = workspace?.defaultCurrencyCode || "USD";

    // Cross-Entity link resolution
    const resolvedWorkOrderId = workOrder.id;
    const resolvedQuoteId = workOrder.sourceQuoteId ?? null;

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
                        customerId: workOrder.customerId,
                        locationId: workOrder.locationId ?? null,
                        quoteId: resolvedQuoteId,
                        workOrderId: resolvedWorkOrderId,
                        status: "DRAFT",
                        title: data.title ?? workOrder.title ?? `Invoice for WorkOrder ${workOrder.workOrderNumber}`,
                        notes: data.notes ?? workOrder.description ?? null,
                        internalNotes: data.internalNotes ?? workOrder.internalNotes ?? null,
                        termsAndConditions: data.termsAndConditions ?? null,
                        currencyCode,
                        issueDate,
                        dueDate,
                        subtotal: new Prisma.Decimal("0.00"),
                        discountType: "FIXED",
                        discountValue: new Prisma.Decimal("0.00"),
                        discountAmount: new Prisma.Decimal("0.00"),
                        taxRate: new Prisma.Decimal("0.0000"),
                        taxAmount: new Prisma.Decimal("0.00"),
                        total: new Prisma.Decimal("0.00"),
                        amountPaid: new Prisma.Decimal("0.00"),
                        amountDue: new Prisma.Decimal("0.00"),
                    },
                });

                // C. Snapshot Line Items from WorkOrder
                const snapshottedLines = snapshotLineItemsFromWorkOrder(workOrder);

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
                        discountType: "FIXED",
                        discountValue: 0,
                        taxRate: 0,
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
                            source: "WORK_ORDER",
                            sourceWorkOrderId: workOrder.id,
                            sourceWorkOrderNumber: workOrder.workOrderNumber,
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
                        customerId: finalInvoice?.customerId || invoice.customerId || workOrder.customerId || "customer_unknown",
                        customerName: finalInvoice?.customer?.name || workOrder.customer?.name,
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
