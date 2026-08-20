/**
 * WorkType domain-specific application errors.
 *
 * Pure domain errors without HTTP status codes.
 * Higher-level route handlers translate these into appropriate HTTP responses.
 */

export class WorkTypeNotFoundError extends Error {
    constructor(message = "Work type not found.") {
        super(message);
        this.name = "WorkTypeNotFoundError";
    }
}

export class DuplicateWorkTypeNameError extends Error {
    constructor(
        message = "A work type with this name already exists in this service catalog.",
    ) {
        super(message);
        this.name = "DuplicateWorkTypeNameError";
    }
}

export class DuplicateWorkTypeCodeError extends Error {
    constructor(
        message = "A work type with this code already exists in this workspace.",
    ) {
        super(message);
        this.name = "DuplicateWorkTypeCodeError";
    }
}

export class WorkTypeCreationError extends Error {
    constructor(message = "Failed to create work type record.") {
        super(message);
        this.name = "WorkTypeCreationError";
    }
}

export class WorkTypeUpdateError extends Error {
    constructor(message = "Failed to update work type record.") {
        super(message);
        this.name = "WorkTypeUpdateError";
    }
}

export class WorkTypeDeletionError extends Error {
    constructor(message = "Failed to delete work type record.") {
        super(message);
        this.name = "WorkTypeDeletionError";
    }
}

export class WorkTypeDeletionNotAllowedError extends Error {
    constructor(
        message = "Work type deletion is not permitted. The work type must first be deactivated and contain no downstream work order references.",
    ) {
        super(message);
        this.name = "WorkTypeDeletionNotAllowedError";
    }
}

export class InvalidWorkTypeDurationError extends Error {
    constructor(
        message = "Estimated duration must be an integer between 5 and 1440 minutes.",
    ) {
        super(message);
        this.name = "InvalidWorkTypeDurationError";
    }
}

export class WorkTypeUnavailableForWorkOrderError extends Error {
    constructor(
        message = "The selected work type is not available for work order creation. Both the work type and its parent service catalog must be active.",
    ) {
        super(message);
        this.name = "WorkTypeUnavailableForWorkOrderError";
    }
}

