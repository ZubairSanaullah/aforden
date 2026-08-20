/**
 * ServiceCatalog domain-specific application errors.
 *
 * Pure domain errors without HTTP status codes.
 * Higher-level route handlers translate these into appropriate HTTP responses.
 */

export class ServiceCatalogNotFoundError extends Error {
    constructor(message = "Service catalog not found.") {
        super(message);
        this.name = "ServiceCatalogNotFoundError";
    }
}

export class DuplicateServiceCatalogNameError extends Error {
    constructor(
        message = "A service catalog with this name already exists in this workspace.",
    ) {
        super(message);
        this.name = "DuplicateServiceCatalogNameError";
    }
}

export class ServiceCatalogCreationError extends Error {
    constructor(message = "Failed to create service catalog record.") {
        super(message);
        this.name = "ServiceCatalogCreationError";
    }
}

export class ServiceCatalogUpdateError extends Error {
    constructor(message = "Failed to update service catalog record.") {
        super(message);
        this.name = "ServiceCatalogUpdateError";
    }
}

export class ServiceCatalogDeletionError extends Error {
    constructor(message = "Failed to delete service catalog record.") {
        super(message);
        this.name = "ServiceCatalogDeletionError";
    }
}

export class ServiceCatalogDeletionNotAllowedError extends Error {
    constructor(
        message = "Service catalog deletion is not permitted. The catalog must first be deactivated and contain zero work types.",
    ) {
        super(message);
        this.name = "ServiceCatalogDeletionNotAllowedError";
    }
}

export class InactiveServiceCatalogError extends Error {
    constructor(
        message = "Cannot perform operations on an inactive service catalog.",
    ) {
        super(message);
        this.name = "InactiveServiceCatalogError";
    }
}
