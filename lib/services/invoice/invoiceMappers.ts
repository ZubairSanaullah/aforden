/**
 * Phase 1.12.3 — Invoicing & Payments Read Model Mappers
 * Converts Prisma entities with Decimal fields and dates into canonical API read models.
 */

import type {
    InvoiceReadModel,
    InvoiceLineItemReadModel,
    PaymentReadModel,
    InvoiceHistoryReadModel,
} from "./invoice.types";

export function mapInvoiceLineItemToReadModel(item: any): InvoiceLineItemReadModel {
    return {
        id: item.id,
        invoiceId: item.invoiceId,
        workspaceId: item.workspaceId,
        lineItemType: item.lineItemType,
        workTypeId: item.workTypeId ?? null,
        partId: item.partId ?? null,
        name: item.name,
        description: item.description ?? null,
        workTypeName: item.workTypeName ?? null,
        workTypeCode: item.workTypeCode ?? null,
        partName: item.partName ?? null,
        partSku: item.partSku ?? null,
        partUnitOfMeasure: item.partUnitOfMeasure ?? null,
        quantity: item.quantity !== undefined && item.quantity !== null
            ? Number(item.quantity).toFixed(2)
            : "1.00",
        unitPrice: item.unitPrice !== undefined && item.unitPrice !== null
            ? Number(item.unitPrice).toFixed(2)
            : "0.00",
        unitCost: item.unitCost !== null && item.unitCost !== undefined
            ? Number(item.unitCost).toFixed(2)
            : null,
        discountAmount: item.discountAmount !== undefined && item.discountAmount !== null
            ? Number(item.discountAmount).toFixed(2)
            : "0.00",
        subtotal: item.subtotal !== undefined && item.subtotal !== null
            ? Number(item.subtotal).toFixed(2)
            : "0.00",
        taxRate: item.taxRate !== undefined && item.taxRate !== null
            ? Number(item.taxRate).toFixed(4)
            : "0.0000",
        taxAmount: item.taxAmount !== undefined && item.taxAmount !== null
            ? Number(item.taxAmount).toFixed(2)
            : "0.00",
        total: item.total !== undefined && item.total !== null
            ? Number(item.total).toFixed(2)
            : "0.00",
        sortOrder: item.sortOrder ?? 0,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt),
        updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : String(item.updatedAt),
    };
}

export function mapPaymentToReadModel(payment: any): PaymentReadModel {
    return {
        id: payment.id,
        workspaceId: payment.workspaceId,
        invoiceId: payment.invoiceId,
        paymentNumber: payment.paymentNumber,
        customerId: payment.customerId,
        amount: payment.amount !== undefined && payment.amount !== null
            ? Number(payment.amount).toFixed(2)
            : "0.00",
        currencyCode: payment.currencyCode ?? "USD",
        paymentMethod: payment.paymentMethod,
        referenceNumber: payment.referenceNumber ?? null,
        status: payment.status,
        paymentDate: payment.paymentDate instanceof Date
            ? payment.paymentDate.toISOString()
            : String(payment.paymentDate),
        notes: payment.notes ?? null,
        recordedByMemberId: payment.recordedByMemberId ?? null,
        recordedByMemberName: payment.recordedByMember?.user?.name ?? null,
        voidedAt: payment.voidedAt instanceof Date ? payment.voidedAt.toISOString() : payment.voidedAt ?? null,
        voidedByMemberId: payment.voidedByMemberId ?? null,
        voidedByMemberName: payment.voidedByMember?.user?.name ?? null,
        voidReason: payment.voidReason ?? null,
        createdAt: payment.createdAt instanceof Date ? payment.createdAt.toISOString() : String(payment.createdAt),
        updatedAt: payment.updatedAt instanceof Date ? payment.updatedAt.toISOString() : String(payment.updatedAt),
    };
}

export function mapInvoiceHistoryToReadModel(hist: any): InvoiceHistoryReadModel {
    const isSystem = hist.metadata?.system === true;
    let actorName = hist.actorName ?? null;

    if (isSystem) {
        actorName = "System";
    } else if (hist.actorMemberId && !actorName) {
        actorName = "Deleted User";
    }

    return {
        id: hist.id,
        invoiceId: hist.invoiceId,
        workspaceId: hist.workspaceId,
        eventType: hist.eventType,
        actorMemberId: hist.actorMemberId ?? null,
        actorName,
        field: hist.field ?? null,
        oldValue: hist.oldValue ?? null,
        newValue: hist.newValue ?? null,
        metadata: hist.metadata ?? null,
        createdAt: hist.createdAt instanceof Date ? hist.createdAt.toISOString() : String(hist.createdAt),
    };
}

export function mapInvoiceToReadModel(invoice: any): InvoiceReadModel {
    return {
        id: invoice.id,
        workspaceId: invoice.workspaceId,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        customer: invoice.customer
            ? {
                  id: invoice.customer.id,
                  customerNumber: invoice.customer.customerNumber ?? null,
                  name: invoice.customer.name,
                  email: invoice.customer.email ?? null,
                  phone: invoice.customer.phone ?? null,
              }
            : undefined,
        locationId: invoice.locationId ?? null,
        location: invoice.location
            ? {
                  id: invoice.location.id,
                  name: invoice.location.name,
                  addressLine1: invoice.location.addressLine1,
                  addressLine2: invoice.location.addressLine2 ?? null,
                  city: invoice.location.city,
                  state: invoice.location.state ?? null,
                  postalCode: invoice.location.postalCode ?? null,
                  country: invoice.location.country,
              }
            : undefined,
        quoteId: invoice.quoteId ?? null,
        quote: invoice.quote
            ? {
                  id: invoice.quote.id,
                  quoteNumber: invoice.quote.quoteNumber,
                  title: invoice.quote.title,
                  total: Number(invoice.quote.total).toFixed(2),
              }
            : undefined,
        workOrderId: invoice.workOrderId ?? null,
        workOrder: invoice.workOrder
            ? {
                  id: invoice.workOrder.id,
                  workOrderNumber: invoice.workOrder.workOrderNumber,
                  title: invoice.workOrder.title,
                  status: invoice.workOrder.status,
              }
            : undefined,
        status: invoice.status,
        title: invoice.title,
        notes: invoice.notes ?? null,
        internalNotes: invoice.internalNotes ?? null,
        termsAndConditions: invoice.termsAndConditions ?? null,
        currencyCode: invoice.currencyCode ?? "USD",
        issueDate: invoice.issueDate instanceof Date
            ? invoice.issueDate.toISOString()
            : String(invoice.issueDate),
        dueDate: invoice.dueDate instanceof Date
            ? invoice.dueDate.toISOString()
            : String(invoice.dueDate),
        subtotal: invoice.subtotal !== undefined && invoice.subtotal !== null
            ? Number(invoice.subtotal).toFixed(2)
            : "0.00",
        discountType: invoice.discountType,
        discountValue: invoice.discountValue !== undefined && invoice.discountValue !== null
            ? Number(invoice.discountValue).toFixed(2)
            : "0.00",
        discountAmount: invoice.discountAmount !== undefined && invoice.discountAmount !== null
            ? Number(invoice.discountAmount).toFixed(2)
            : "0.00",
        taxRate: invoice.taxRate !== undefined && invoice.taxRate !== null
            ? Number(invoice.taxRate).toFixed(4)
            : "0.0000",
        taxAmount: invoice.taxAmount !== undefined && invoice.taxAmount !== null
            ? Number(invoice.taxAmount).toFixed(2)
            : "0.00",
        total: invoice.total !== undefined && invoice.total !== null
            ? Number(invoice.total).toFixed(2)
            : "0.00",
        amountPaid: invoice.amountPaid !== undefined && invoice.amountPaid !== null
            ? Number(invoice.amountPaid).toFixed(2)
            : "0.00",
        amountDue: invoice.amountDue !== undefined && invoice.amountDue !== null
            ? Number(invoice.amountDue).toFixed(2)
            : "0.00",
        issuedAt: invoice.issuedAt instanceof Date ? invoice.issuedAt.toISOString() : invoice.issuedAt ?? null,
        paidAt: invoice.paidAt instanceof Date ? invoice.paidAt.toISOString() : invoice.paidAt ?? null,
        voidedAt: invoice.voidedAt instanceof Date ? invoice.voidedAt.toISOString() : invoice.voidedAt ?? null,
        voidReason: invoice.voidReason ?? null,
        lineItems: Array.isArray(invoice.lineItems)
            ? invoice.lineItems.map(mapInvoiceLineItemToReadModel)
            : undefined,
        payments: Array.isArray(invoice.payments)
            ? invoice.payments.map(mapPaymentToReadModel)
            : undefined,
        history: Array.isArray(invoice.history)
            ? invoice.history.map(mapInvoiceHistoryToReadModel)
            : undefined,
        createdAt: invoice.createdAt instanceof Date ? invoice.createdAt.toISOString() : String(invoice.createdAt),
        updatedAt: invoice.updatedAt instanceof Date ? invoice.updatedAt.toISOString() : String(invoice.updatedAt),
    };
}
