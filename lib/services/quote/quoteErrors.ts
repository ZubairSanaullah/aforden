/**
 * Phase 1.11.3 — Quotes & Estimates Pure Domain Error Classes
 * Follows Convention B: pure Error subclasses with immutable readonly code, statusCode, and httpStatus metadata.
 */

export class QuoteNotFoundError extends Error {
    readonly code = "QUOTE_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Quote not found.") {
        super(message);
        this.name = "QuoteNotFoundError";
    }
}

export class QuoteLineItemNotFoundError extends Error {
    readonly code = "QUOTE_LINE_ITEM_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Quote line item not found.") {
        super(message);
        this.name = "QuoteLineItemNotFoundError";
    }
}

export class QuoteStatusConflictError extends Error {
    readonly code = "QUOTE_STATUS_CONFLICT";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "The quote status does not permit this operation.",
    ) {
        super(message);
        this.name = "QuoteStatusConflictError";
    }
}

export class QuoteAlreadyConvertedError extends Error {
    readonly code = "QUOTE_ALREADY_CONVERTED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Quote has already been converted to a work order.",
    ) {
        super(message);
        this.name = "QuoteAlreadyConvertedError";
    }
}

export class QuoteExpiredError extends Error {
    readonly code = "QUOTE_EXPIRED";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Quote has expired and cannot be approved or converted without revision.",
    ) {
        super(message);
        this.name = "QuoteExpiredError";
    }
}

export class QuoteEmptyLineItemsError extends Error {
    readonly code = "QUOTE_EMPTY_LINE_ITEMS";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Quote must have at least one line item before it can be sent or converted.",
    ) {
        super(message);
        this.name = "QuoteEmptyLineItemsError";
    }
}

export class InvalidQuoteCalculationError extends Error {
    readonly code = "INVALID_QUOTE_CALCULATION";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Invalid quote calculation: line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative.",
    ) {
        super(message);
        this.name = "InvalidQuoteCalculationError";
    }
}

export class MissingRejectionReasonError extends Error {
    readonly code = "MISSING_REJECTION_REASON";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Rejection reason is required when rejecting a quote.",
    ) {
        super(message);
        this.name = "MissingRejectionReasonError";
    }
}

