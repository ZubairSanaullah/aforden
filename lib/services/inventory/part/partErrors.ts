/**
 * Phase 1.10 Part Catalog Domain Errors
 * Convention B: Structured errors with readonly code, statusCode, and httpStatus.
 */

export class PartNotFoundError extends Error {
    readonly code = "PART_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Part not found in authorized workspace.") {
        super(message);
        this.name = "PartNotFoundError";
    }
}

export class PartInactiveError extends Error {
    readonly code = "PART_INACTIVE";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Part is inactive and cannot be used for stock movements or consumption.",
    ) {
        super(message);
        this.name = "PartInactiveError";
    }
}

export class PartImmutableError extends Error {
    readonly code = "PART_IMMUTABLE";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Part cannot be modified in a manner that violates historical integrity.",
    ) {
        super(message);
        this.name = "PartImmutableError";
    }
}

export class DuplicatePartSkuError extends Error {
    readonly code = "DUPLICATE_PART_SKU";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "A part with this SKU already exists in this workspace.",
    ) {
        super(message);
        this.name = "DuplicatePartSkuError";
    }
}

export class DuplicatePartNameError extends Error {
    readonly code = "DUPLICATE_PART_NAME";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "A part with this name already exists in this workspace.",
    ) {
        super(message);
        this.name = "DuplicatePartNameError";
    }
}

export class PartDeletionNotAllowedError extends Error {
    readonly code = "PART_DELETION_NOT_ALLOWED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Part deletion is not permitted. Parts must be transitioned to INACTIVE status instead.",
    ) {
        super(message);
        this.name = "PartDeletionNotAllowedError";
    }
}
