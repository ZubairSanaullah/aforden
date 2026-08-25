/**
 * Phase 1.12.3 — Invoicing & Payments Domain Types & Read Models
 * Clean API-facing contracts without leaking internal database or Prisma types.
 */

import {
    InvoiceStatus,
    InvoiceLineItemType,
    InvoiceDiscountType,
    PaymentMethod,
    PaymentStatus,
    InvoiceHistoryEventType,
} from "@/generated/prisma/enums";

export {
    InvoiceStatus,
    InvoiceLineItemType,
    InvoiceDiscountType,
    PaymentMethod,
    PaymentStatus,
    InvoiceHistoryEventType,
};

// ==========================================
// CANONICAL API SNIPPETS & READ MODELS
// ==========================================

export interface InvoiceCustomerSnippet {
    id: string;
    customerNumber: string | null;
    name: string;
    email: string | null;
    phone: string | null;
}

export interface InvoiceLocationSnippet {
    id: string;
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string | null;
    postalCode: string | null;
    country: string;
}

export interface InvoiceQuoteSnippet {
    id: string;
    quoteNumber: string;
    title: string;
    total: string;
}

export interface InvoiceWorkOrderSnippet {
    id: string;
    workOrderNumber: string;
    title: string;
    status: string;
}

export interface InvoiceLineItemReadModel {
    id: string;
    invoiceId: string;
    workspaceId: string;
    lineItemType: InvoiceLineItemType;
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

export interface PaymentReadModel {
    id: string;
    workspaceId: string;
    invoiceId: string;
    paymentNumber: string;
    customerId: string;
    amount: string;
    currencyCode: string;
    paymentMethod: PaymentMethod;
    referenceNumber: string | null;
    status: PaymentStatus;
    paymentDate: string;
    notes: string | null;
    recordedByMemberId: string | null;
    recordedByMemberName?: string | null;
    voidedAt: string | null;
    voidedByMemberId: string | null;
    voidedByMemberName?: string | null;
    voidReason: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface InvoiceHistoryReadModel {
    id: string;
    invoiceId: string;
    workspaceId: string;
    eventType: InvoiceHistoryEventType;
    actorMemberId: string | null;
    actorName: string | null;
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    metadata: Record<string, any> | null;
    createdAt: string;
}

export interface PaginatedInvoiceHistoryReadModel {
    items: InvoiceHistoryReadModel[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface InvoiceReadModel {
    id: string;
    workspaceId: string;
    invoiceNumber: string;
    customerId: string;
    customer?: InvoiceCustomerSnippet;
    locationId: string | null;
    location?: InvoiceLocationSnippet | null;
    quoteId: string | null;
    quote?: InvoiceQuoteSnippet | null;
    workOrderId: string | null;
    workOrder?: InvoiceWorkOrderSnippet | null;
    status: InvoiceStatus;
    title: string;
    notes: string | null;
    internalNotes: string | null;
    termsAndConditions: string | null;
    currencyCode: string;
    issueDate: string;
    dueDate: string;
    subtotal: string;
    discountType: InvoiceDiscountType;
    discountValue: string;
    discountAmount: string;
    taxRate: string;
    taxAmount: string;
    total: string;
    amountPaid: string;
    amountDue: string;
    issuedAt: string | null;
    paidAt: string | null;
    voidedAt: string | null;
    voidReason: string | null;
    lineItems?: InvoiceLineItemReadModel[];
    payments?: PaymentReadModel[];
    history?: InvoiceHistoryReadModel[];
    createdAt: string;
    updatedAt: string;
}

// ==========================================
// PAGINATION & SUMMARY READ MODELS
// ==========================================

export interface PaginatedInvoicesResponse {
    items: InvoiceReadModel[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export type PaginatedInvoicesReadModel = PaginatedInvoicesResponse;

export interface PaginatedPaymentsResponse {
    items: PaymentReadModel[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export type PaginatedPaymentsReadModel = PaginatedPaymentsResponse;

export interface CustomerOutstandingBalanceReadModel {
    customerId: string;
    totalOutstandingBalance: string;
    currencyCode: string;
    invoiceCount: number;
}
