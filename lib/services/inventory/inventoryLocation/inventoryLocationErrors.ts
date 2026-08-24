/**
 * Phase 1.10 InventoryLocation Domain Errors
 * Convention B: Structured errors with readonly code, statusCode, and httpStatus.
 */

export class InventoryLocationNotFoundError extends Error {
    readonly code = "INVENTORY_LOCATION_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Inventory location not found in authorized workspace.") {
        super(message);
        this.name = "InventoryLocationNotFoundError";
    }
}

export class InventoryLocationInactiveError extends Error {
    readonly code = "INVENTORY_LOCATION_INACTIVE";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Inventory location is inactive and cannot be used for stock operations.",
    ) {
        super(message);
        this.name = "InventoryLocationInactiveError";
    }
}

export class DuplicateInventoryLocationError extends Error {
    readonly code = "DUPLICATE_INVENTORY_LOCATION";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "An inventory location with this name or code already exists in this workspace.",
    ) {
        super(message);
        this.name = "DuplicateInventoryLocationError";
    }
}

export class InventoryLocationDeletionNotAllowedError extends Error {
    readonly code = "INVENTORY_LOCATION_DELETION_NOT_ALLOWED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Inventory location deletion is not permitted. Locations must be transitioned to INACTIVE status instead.",
    ) {
        super(message);
        this.name = "InventoryLocationDeletionNotAllowedError";
    }
}

export class TechnicianStockLocationAlreadyExistsError extends Error {
    readonly code = "TECHNICIAN_STOCK_LOCATION_ALREADY_EXISTS";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "An active personal technician stock location already exists for this technician profile in this workspace.",
    ) {
        super(message);
        this.name = "TechnicianStockLocationAlreadyExistsError";
    }
}
