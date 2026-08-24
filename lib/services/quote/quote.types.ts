/**
 * Phase 1.11.3 — Quotes & Estimates Domain Types & Read Models
 * Clean API-facing contracts without leaking internal database or Prisma types.
 */

import {
    QuoteStatus,
    QuoteLineItemType,
    QuoteDiscountType,
    QuoteHistoryEventType,
} from "@/generated/prisma/enums";

export {
    QuoteStatus,
    QuoteLineItemType,
    QuoteDiscountType,
    QuoteHistoryEventType,
};

// ==========================================
// CANONICAL API READ MODELS
// ==========================================

export interface QuoteCustomerSnippet {
    id: string;
    customerNumber: string | null;
    name: string;
    email: string | null;
    phone: string | null;
}

export interface QuoteLocationSnippet {
    id: string;
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string | null;
    postalCode: string | null;
    country: string;
}

export interface QuoteLineItemReadModel {
    id: string;
    quoteId: string;
    workspaceId: string;
    lineItemType: QuoteLineItemType;
    workTypeId: string | null;
    partId: string | null;
    name: string;
    description: string | null;
    workTypeName: string | null;
    workTypeCode: string | null;
    partName: string | null;
    partSku: string | null;
    partUnitOfMeasure: string | null;
    quantity: string;
    unitPrice: string;
    unitCost: string | null;
    discountAmount: string;
    subtotal: string;
    taxRate: string;
    taxAmount: string;
    total: string;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

export interface QuoteReadModel {
    id: string;
    workspaceId: string;
    quoteNumber: string;
    customerId: string;
    customer?: QuoteCustomerSnippet;
    locationId: string | null;
    location?: QuoteLocationSnippet | null;
    status: QuoteStatus;
    title: string;
    description: string | null;
    internalNotes: string | null;
    termsAndConditions: string | null;
    currencyCode: string;
    validUntil: string | null;
    subtotal: string;
    discountType: QuoteDiscountType;
    discountValue: string;
    discountAmount: string;
    taxRate: string;
    taxAmount: string;
    total: string;
    sentAt: string | null;
    approvedAt: string | null;
    approvedByCustomerName: string | null;
    rejectedAt: string | null;
    rejectionReason: string | null;
    convertedAt: string | null;
    convertedWorkOrderId: string | null;
    convertedByMemberId: string | null;
    createdAt: string;
    updatedAt: string;
    lineItems?: QuoteLineItemReadModel[];
    lineItemCount?: number;
}

export interface QuoteHistoryReadModel {
    id: string;
    quoteId: string;
    workspaceId: string;
    eventType: QuoteHistoryEventType;
    actorMemberId: string | null;
    actorName: string | null;
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    metadata: Record<string, any> | null;
    createdAt: string;
}

export interface PaginatedQuotesReadModel {
    items: QuoteReadModel[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// ==========================================
// SERVICE INPUT DTO INTERFACES
// ==========================================

export interface CreateQuoteInput {
    customerId: string;
    locationId?: string | null;
    title: string;
    description?: string | null;
    internalNotes?: string | null;
    termsAndConditions?: string | null;
    currencyCode?: string;
    validUntil?: Date | string | null;
    discountType?: QuoteDiscountType;
    discountValue?: number | string;
    taxRate?: number | string;
}

export interface UpdateQuoteInput {
    customerId?: string;
    locationId?: string | null;
    title?: string;
    description?: string | null;
    internalNotes?: string | null;
    termsAndConditions?: string | null;
    validUntil?: Date | string | null;
    discountType?: QuoteDiscountType;
    discountValue?: number | string;
    taxRate?: number | string;
}

export interface CreateQuoteLineItemInput {
    lineItemType?: QuoteLineItemType;
    workTypeId?: string | null;
    partId?: string | null;
    name: string;
    description?: string | null;
    quantity: number | string;
    unitPrice: number | string;
    unitCost?: number | string | null;
    discountAmount?: number | string;
    taxRate?: number | string;
    sortOrder?: number;
}

export interface UpdateQuoteLineItemInput {
    lineItemType?: QuoteLineItemType;
    workTypeId?: string | null;
    partId?: string | null;
    name?: string;
    description?: string | null;
    quantity?: number | string;
    unitPrice?: number | string;
    unitCost?: number | string | null;
    discountAmount?: number | string;
    taxRate?: number | string;
    sortOrder?: number;
}

export interface SendQuoteInput {
    notes?: string;
}

export interface ApproveQuoteInput {
    approvedByCustomerName?: string | null;
    notes?: string | null;
}

export interface RejectQuoteInput {
    rejectionReason: string;
}

export interface ConvertQuoteInput {
    workTypeId?: string;
    assignedTechnicianId?: string;
    title?: string;
    description?: string;
}

export interface ListQuotesQueryInput {
    status?: QuoteStatus | QuoteStatus[];
    customerId?: string;
    locationId?: string;
    search?: string;
    validUntilFrom?: Date | string;
    validUntilTo?: Date | string;
    createdFrom?: Date | string;
    createdTo?: Date | string;
    minTotal?: number;
    maxTotal?: number;
    sortBy?: "createdAt" | "updatedAt" | "quoteNumber" | "total" | "validUntil" | "status";
    sortOrder?: "asc" | "desc";
    page?: number;
    limit?: number;
}
