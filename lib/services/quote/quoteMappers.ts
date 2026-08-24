/**
 * Phase 1.11.5 — Quotes & Estimates Read Model Mappers
 * Converts Prisma entities with Decimal fields and dates into canonical API read models.
 */

import type {
    QuoteReadModel,
    QuoteLineItemReadModel,
    QuoteHistoryReadModel,
} from "./quote.types";

export function mapQuoteLineItemToReadModel(item: any): QuoteLineItemReadModel {
    return {
        id: item.id,
        quoteId: item.quoteId,
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

export function mapQuoteHistoryToReadModel(hist: any): QuoteHistoryReadModel {
    return {
        id: hist.id,
        quoteId: hist.quoteId,
        workspaceId: hist.workspaceId,
        eventType: hist.eventType,
        actorMemberId: hist.actorMemberId ?? null,
        actorName: hist.actorName ?? null,
        field: hist.field ?? null,
        oldValue: hist.oldValue ?? null,
        newValue: hist.newValue ?? null,
        metadata: hist.metadata ?? null,
        createdAt: hist.createdAt instanceof Date ? hist.createdAt.toISOString() : String(hist.createdAt),
    };
}

export function mapQuoteToReadModel(quote: any): QuoteReadModel {
    return {
        id: quote.id,
        workspaceId: quote.workspaceId,
        quoteNumber: quote.quoteNumber,
        customerId: quote.customerId,
        customer: quote.customer
            ? {
                  id: quote.customer.id,
                  customerNumber: quote.customer.customerNumber ?? null,
                  name: quote.customer.name,
                  email: quote.customer.email ?? null,
                  phone: quote.customer.phone ?? null,
              }
            : undefined,
        locationId: quote.locationId ?? null,
        location: quote.location
            ? {
                  id: quote.location.id,
                  name: quote.location.name,
                  addressLine1: quote.location.addressLine1,
                  addressLine2: quote.location.addressLine2 ?? null,
                  city: quote.location.city,
                  state: quote.location.state ?? null,
                  postalCode: quote.location.postalCode ?? null,
                  country: quote.location.country,
              }
            : quote.locationId === null
            ? null
            : undefined,
        status: quote.status,
        title: quote.title,
        description: quote.description ?? null,
        internalNotes: quote.internalNotes ?? null,
        termsAndConditions: quote.termsAndConditions ?? null,
        currencyCode: quote.currencyCode,
        validUntil: quote.validUntil
            ? quote.validUntil instanceof Date
                ? quote.validUntil.toISOString()
                : String(quote.validUntil)
            : null,
        subtotal: quote.subtotal !== undefined && quote.subtotal !== null
            ? Number(quote.subtotal).toFixed(2)
            : "0.00",
        discountType: quote.discountType,
        discountValue: quote.discountValue !== undefined && quote.discountValue !== null
            ? Number(quote.discountValue).toFixed(2)
            : "0.00",
        discountAmount: quote.discountAmount !== undefined && quote.discountAmount !== null
            ? Number(quote.discountAmount).toFixed(2)
            : "0.00",
        taxRate: quote.taxRate !== undefined && quote.taxRate !== null
            ? Number(quote.taxRate).toFixed(4)
            : "0.0000",
        taxAmount: quote.taxAmount !== undefined && quote.taxAmount !== null
            ? Number(quote.taxAmount).toFixed(2)
            : "0.00",
        total: quote.total !== undefined && quote.total !== null
            ? Number(quote.total).toFixed(2)
            : "0.00",
        sentAt: quote.sentAt
            ? quote.sentAt instanceof Date
                ? quote.sentAt.toISOString()
                : String(quote.sentAt)
            : null,
        approvedAt: quote.approvedAt
            ? quote.approvedAt instanceof Date
                ? quote.approvedAt.toISOString()
                : String(quote.approvedAt)
            : null,
        approvedByCustomerName: quote.approvedByCustomerName ?? null,
        rejectedAt: quote.rejectedAt
            ? quote.rejectedAt instanceof Date
                ? quote.rejectedAt.toISOString()
                : String(quote.rejectedAt)
            : null,
        rejectionReason: quote.rejectionReason ?? null,
        convertedAt: quote.convertedAt
            ? quote.convertedAt instanceof Date
                ? quote.convertedAt.toISOString()
                : String(quote.convertedAt)
            : null,
        convertedWorkOrderId: quote.convertedWorkOrderId ?? null,
        convertedByMemberId: quote.convertedByMemberId ?? null,
        createdAt: quote.createdAt instanceof Date ? quote.createdAt.toISOString() : String(quote.createdAt),
        updatedAt: quote.updatedAt instanceof Date ? quote.updatedAt.toISOString() : String(quote.updatedAt),
        lineItems: quote.lineItems ? quote.lineItems.map(mapQuoteLineItemToReadModel) : undefined,
        lineItemCount: quote._count?.lineItems ?? (quote.lineItems ? quote.lineItems.length : undefined),
    };
}
