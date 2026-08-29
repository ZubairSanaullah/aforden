import type { QuoteReadModel, QuoteLineItemReadModel } from "@/lib/services/quote/quote.types";

/**
 * Canonical external representation of Quote line item.
 *
 * Privacy & Security Invariants:
 * - Excludes `unitCost` (Wholesale/internal item cost - protects company profit margins)
 */
export interface PublicQuoteLineItemDto {
    id: string;
    lineItemType: string;
    workTypeId: string | null;
    partId: string | null;
    name: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
    subtotal: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    sortOrder: number;
}

/**
 * Canonical external representation of a Quote resource.
 *
 * Privacy & Security Invariants:
 * - Excludes `workspaceId` (Tenant boundary security invariant)
 * - Excludes `internalNotes` (Internal sales/pricing notes)
 * - Excludes `convertedByMemberId` (Internal staff audit user ID)
 * - Excludes `history` (Internal audit event log)
 */
export interface PublicQuoteDto {
    id: string;
    quoteNumber: string;
    customerId: string;
    locationId: string | null;
    status: string;
    title: string;
    description: string | null;
    termsAndConditions: string | null;
    currencyCode: string;
    validUntil: string | null;
    subtotal: number;
    discountType: string;
    discountValue: number;
    discountAmount: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    sentAt: string | null;
    approvedAt: string | null;
    approvedByCustomerName: string | null;
    rejectedAt: string | null;
    rejectionReason: string | null;
    convertedAt: string | null;
    convertedWorkOrderId: string | null;
    lineItems?: PublicQuoteLineItemDto[];
    createdAt: string;
    updatedAt: string;
}

export const APPROVED_PUBLIC_QUOTE_LINE_ITEM_DTO_KEYS = [
    "id",
    "lineItemType",
    "workTypeId",
    "partId",
    "name",
    "description",
    "quantity",
    "unitPrice",
    "discountAmount",
    "subtotal",
    "taxRate",
    "taxAmount",
    "total",
    "sortOrder",
] as const;

export const APPROVED_PUBLIC_QUOTE_DTO_KEYS = [
    "id",
    "quoteNumber",
    "customerId",
    "locationId",
    "status",
    "title",
    "description",
    "termsAndConditions",
    "currencyCode",
    "validUntil",
    "subtotal",
    "discountType",
    "discountValue",
    "discountAmount",
    "taxRate",
    "taxAmount",
    "total",
    "sentAt",
    "approvedAt",
    "approvedByCustomerName",
    "rejectedAt",
    "rejectionReason",
    "convertedAt",
    "convertedWorkOrderId",
    "createdAt",
    "updatedAt",
] as const;

export function toPublicQuoteLineItemDto(item: QuoteLineItemReadModel | any): PublicQuoteLineItemDto {
    return {
        id: item.id,
        lineItemType: item.lineItemType,
        workTypeId: item.workTypeId ?? null,
        partId: item.partId ?? null,
        name: item.name,
        description: item.description ?? null,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discountAmount: Number(item.discountAmount),
        subtotal: Number(item.subtotal),
        taxRate: Number(item.taxRate),
        taxAmount: Number(item.taxAmount),
        total: Number(item.total),
        sortOrder: item.sortOrder,
    };
}

/**
 * Maps an internal Quote read model to the canonical PublicQuoteDto.
 */
export function toPublicQuoteDto(item: QuoteReadModel | any): PublicQuoteDto {
    const lineItems = Array.isArray(item.lineItems)
        ? item.lineItems.map(toPublicQuoteLineItemDto)
        : undefined;

    const dto: PublicQuoteDto = {
        id: item.id,
        quoteNumber: item.quoteNumber,
        customerId: item.customerId,
        locationId: item.locationId ?? null,
        status: item.status,
        title: item.title,
        description: item.description ?? null,
        termsAndConditions: item.termsAndConditions ?? null,
        currencyCode: item.currencyCode || "USD",
        validUntil: item.validUntil ? new Date(item.validUntil).toISOString() : null,
        subtotal: Number(item.subtotal),
        discountType: item.discountType,
        discountValue: Number(item.discountValue),
        discountAmount: Number(item.discountAmount),
        taxRate: Number(item.taxRate),
        taxAmount: Number(item.taxAmount),
        total: Number(item.total),
        sentAt: item.sentAt ? new Date(item.sentAt).toISOString() : null,
        approvedAt: item.approvedAt ? new Date(item.approvedAt).toISOString() : null,
        approvedByCustomerName: item.approvedByCustomerName ?? null,
        rejectedAt: item.rejectedAt ? new Date(item.rejectedAt).toISOString() : null,
        rejectionReason: item.rejectionReason ?? null,
        convertedAt: item.convertedAt ? new Date(item.convertedAt).toISOString() : null,
        convertedWorkOrderId: item.convertedWorkOrderId ?? null,
        createdAt: new Date(item.createdAt).toISOString(),
        updatedAt: new Date(item.updatedAt).toISOString(),
    };

    if (lineItems) {
        dto.lineItems = lineItems;
    }

    return dto;
}
