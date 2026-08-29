import type { InvoiceReadModel, InvoiceLineItemReadModel } from "@/lib/services/invoice/invoice.types";

/**
 * Canonical external representation of Invoice line item.
 *
 * Privacy & Security Invariants:
 * - Excludes `unitCost` (Wholesale/internal item cost - protects company profit margins)
 */
export interface PublicInvoiceLineItemDto {
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
 * Canonical external representation of an Invoice resource.
 *
 * Privacy & Security Invariants:
 * - Excludes `workspaceId` (Tenant boundary security invariant)
 * - Excludes `internalNotes` (Internal accounting/collections notes)
 * - Excludes `payments` raw transaction arrays / payment gateway tokens
 * - Excludes `history` (Internal audit event log)
 */
export interface PublicInvoiceDto {
    id: string;
    invoiceNumber: string;
    customerId: string;
    locationId: string | null;
    quoteId: string | null;
    workOrderId: string | null;
    status: string;
    title: string;
    notes: string | null;
    termsAndConditions: string | null;
    currencyCode: string;
    issueDate: string;
    dueDate: string;
    subtotal: number;
    discountType: string;
    discountValue: number;
    discountAmount: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    amountPaid: number;
    amountDue: number;
    issuedAt: string | null;
    paidAt: string | null;
    voidedAt: string | null;
    voidReason: string | null;
    lineItems?: PublicInvoiceLineItemDto[];
    createdAt: string;
    updatedAt: string;
}

export const APPROVED_PUBLIC_INVOICE_LINE_ITEM_DTO_KEYS = [
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

export const APPROVED_PUBLIC_INVOICE_DTO_KEYS = [
    "id",
    "invoiceNumber",
    "customerId",
    "locationId",
    "quoteId",
    "workOrderId",
    "status",
    "title",
    "notes",
    "termsAndConditions",
    "currencyCode",
    "issueDate",
    "dueDate",
    "subtotal",
    "discountType",
    "discountValue",
    "discountAmount",
    "taxRate",
    "taxAmount",
    "total",
    "amountPaid",
    "amountDue",
    "issuedAt",
    "paidAt",
    "voidedAt",
    "voidReason",
    "createdAt",
    "updatedAt",
] as const;

export function toPublicInvoiceLineItemDto(
    item: InvoiceLineItemReadModel | any,
): PublicInvoiceLineItemDto {
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
 * Maps an internal Invoice read model to the canonical PublicInvoiceDto.
 */
export function toPublicInvoiceDto(
    item: InvoiceReadModel | any,
): PublicInvoiceDto {
    const lineItems = Array.isArray(item.lineItems)
        ? item.lineItems.map(toPublicInvoiceLineItemDto)
        : undefined;

    const dto: PublicInvoiceDto = {
        id: item.id,
        invoiceNumber: item.invoiceNumber,
        customerId: item.customerId,
        locationId: item.locationId ?? null,
        quoteId: item.quoteId ?? null,
        workOrderId: item.workOrderId ?? null,
        status: item.status,
        title: item.title,
        notes: item.notes ?? null,
        termsAndConditions: item.termsAndConditions ?? null,
        currencyCode: item.currencyCode || "USD",
        issueDate: new Date(item.issueDate).toISOString(),
        dueDate: new Date(item.dueDate).toISOString(),
        subtotal: Number(item.subtotal),
        discountType: item.discountType,
        discountValue: Number(item.discountValue),
        discountAmount: Number(item.discountAmount),
        taxRate: Number(item.taxRate),
        taxAmount: Number(item.taxAmount),
        total: Number(item.total),
        amountPaid: Number(item.amountPaid),
        amountDue: Number(item.amountDue),
        issuedAt: item.issuedAt ? new Date(item.issuedAt).toISOString() : null,
        paidAt: item.paidAt ? new Date(item.paidAt).toISOString() : null,
        voidedAt: item.voidedAt ? new Date(item.voidedAt).toISOString() : null,
        voidReason: item.voidReason ?? null,
        createdAt: new Date(item.createdAt).toISOString(),
        updatedAt: new Date(item.updatedAt).toISOString(),
    };

    if (lineItems) {
        dto.lineItems = lineItems;
    }

    return dto;
}
