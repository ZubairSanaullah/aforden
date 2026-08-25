/**
 * Phase 1.12.3 — Invoicing & Payments Pure Domain Error Classes
 * Follows Convention B: pure Error subclasses with immutable readonly code, statusCode, and httpStatus metadata.
 */

export class InvoiceNotFoundError extends Error {
    readonly code = "INVOICE_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Invoice not found.") {
        super(message);
        this.name = "InvoiceNotFoundError";
    }
}

export class InvoiceLineItemNotFoundError extends Error {
    readonly code = "INVOICE_LINE_ITEM_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Invoice line item not found.") {
        super(message);
        this.name = "InvoiceLineItemNotFoundError";
    }
}

export class PaymentNotFoundError extends Error {
    readonly code = "PAYMENT_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Payment not found.") {
        super(message);
        this.name = "PaymentNotFoundError";
    }
}

export class InvoiceStatusConflictError extends Error {
    readonly code = "INVOICE_STATUS_CONFLICT";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "The invoice status does not permit this operation.",
    ) {
        super(message);
        this.name = "InvoiceStatusConflictError";
    }
}

export class InvoiceAlreadyPaidError extends Error {
    readonly code = "INVOICE_ALREADY_PAID";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Invoice is already fully paid and cannot accept additional payments.",
    ) {
        super(message);
        this.name = "InvoiceAlreadyPaidError";
    }
}

export class InvoiceAlreadyVoidedError extends Error {
    readonly code = "INVOICE_ALREADY_VOIDED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Invoice has been voided and cannot be modified or receive payments.",
    ) {
        super(message);
        this.name = "InvoiceAlreadyVoidedError";
    }
}

export class PaymentAlreadyVoidedError extends Error {
    readonly code = "PAYMENT_ALREADY_VOIDED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Payment is already voided and cannot be voided again.",
    ) {
        super(message);
        this.name = "PaymentAlreadyVoidedError";
    }
}

export class InvoiceHasActivePaymentsError extends Error {
    readonly code = "INVOICE_HAS_ACTIVE_PAYMENTS";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Cannot void or delete an invoice with active recorded payments. Void all associated payments first.",
    ) {
        super(message);
        this.name = "InvoiceHasActivePaymentsError";
    }
}

export class OverpaymentNotAllowedError extends Error {
    readonly code = "OVERPAYMENT_NOT_ALLOWED";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Payment amount exceeds the outstanding balance due on this invoice.",
    ) {
        super(message);
        this.name = "OverpaymentNotAllowedError";
    }
}

export class InvalidPaymentAmountError extends Error {
    readonly code = "INVALID_PAYMENT_AMOUNT";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Payment amount must be greater than zero and have at most 2 decimal places.",
    ) {
        super(message);
        this.name = "InvalidPaymentAmountError";
    }
}

export class InvoiceEmptyLineItemsError extends Error {
    readonly code = "INVOICE_EMPTY_LINE_ITEMS";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Invoice must contain at least one line item before it can be issued.",
    ) {
        super(message);
        this.name = "InvoiceEmptyLineItemsError";
    }
}

export class InvalidInvoiceCalculationError extends Error {
    readonly code = "INVALID_INVOICE_CALCULATION";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Invalid invoice calculation: line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative.",
    ) {
        super(message);
        this.name = "InvalidInvoiceCalculationError";
    }
}

export class SourceEntityNotEligibleError extends Error {
    readonly code = "SOURCE_ENTITY_NOT_ELIGIBLE";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Source entity is not in an eligible status to generate an invoice (Quotes must be APPROVED or CONVERTED; WorkOrders must be COMPLETED).",
    ) {
        super(message);
        this.name = "SourceEntityNotEligibleError";
    }
}

export class MissingVoidReasonError extends Error {
    readonly code = "MISSING_VOID_REASON";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "A void reason is required when voiding an invoice or payment.",
    ) {
        super(message);
        this.name = "MissingVoidReasonError";
    }
}

export class InvoiceDueDateInvalidError extends Error {
    readonly code = "INVOICE_DUE_DATE_INVALID";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Invoice due date must be on or after the issue date.",
    ) {
        super(message);
        this.name = "InvoiceDueDateInvalidError";
    }
}

/**
 * NEW ERROR CLASS PROPOSAL (Phase 1.12.9)
 * Not in the original 1.12.1 taxonomy of 15 errors.
 * Triggered when `issueInvoice` recomputes totals via the calculation engine
 * and finds they diverge from the stored snapshot on the invoice record.
 * This is a financial integrity guard — the stored totals must reflect the live
 * line items before issuance can proceed. A mismatch indicates either a failed
 * prior calculation, a race condition, or a direct DB mutation bypassing service
 * layer invariants.
 *
 * HTTP 409 Conflict is appropriate: the resource state is internally inconsistent
 * and cannot be safely transitioned. The client should refresh and re-inspect the
 * invoice before retrying.
 */
export class InvoiceTotalsMismatchError extends Error {
    readonly code = "INVOICE_TOTALS_MISMATCH";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Invoice totals are inconsistent with the current line items. Recalculate the invoice before issuing.",
    ) {
        super(message);
        this.name = "InvoiceTotalsMismatchError";
    }
}
