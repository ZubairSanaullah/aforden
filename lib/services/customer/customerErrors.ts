/**
 * Customer domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers (API route handlers / Server Actions) translate
 * these into appropriate HTTP responses.
 */

export class CustomerNotFoundError extends Error {
    constructor(message = "Customer not found.") {
        super(message);
        this.name = "CustomerNotFoundError";
    }
}

export class InactiveCustomerError extends Error {
    constructor(message = "Cannot perform operations on contacts for an inactive customer.") {
        super(message);
        this.name = "InactiveCustomerError";
    }
}

export class DuplicateCustomerNumberError extends Error {
    constructor(
        message = "A customer with this customer number already exists in this workspace.",
    ) {
        super(message);
        this.name = "DuplicateCustomerNumberError";
    }
}

export class CustomerCreationError extends Error {
    constructor(message = "Failed to create customer record.") {
        super(message);
        this.name = "CustomerCreationError";
    }
}

export class CustomerUpdateError extends Error {
    constructor(message = "Failed to update customer record.") {
        super(message);
        this.name = "CustomerUpdateError";
    }
}

export class InvalidCustomerError extends Error {
    constructor(message = "Invalid customer data.") {
        super(message);
        this.name = "InvalidCustomerError";
    }
}

export class CustomerDeletionError extends Error {
    constructor(message = "Failed to delete customer record.") {
        super(message);
        this.name = "CustomerDeletionError";
    }
}

export class CustomerDeletionNotAllowedError extends Error {
    constructor(
        message = "Customer deletion is not permitted. The customer must first be deactivated and have no protected operational references.",
    ) {
        super(message);
        this.name = "CustomerDeletionNotAllowedError";
    }
}

export class CustomerHasProtectedReferencesError extends CustomerDeletionNotAllowedError {
    constructor(
        message = "Cannot delete customer with existing operational history or protected references.",
    ) {
        super(message);
        this.name = "CustomerHasProtectedReferencesError";
    }
}

export class CustomerContactCreationError extends Error {
    constructor(message = "Failed to create customer contact record.") {
        super(message);
        this.name = "CustomerContactCreationError";
    }
}

export class CustomerContactUpdateError extends Error {
    constructor(message = "Failed to update customer contact record.") {
        super(message);
        this.name = "CustomerContactUpdateError";
    }
}

export class CustomerContactNotFoundError extends Error {
    constructor(message = "Customer contact not found.") {
        super(message);
        this.name = "CustomerContactNotFoundError";
    }
}

export class CustomerContactPrimaryExistsError extends Error {
    constructor(
        message = "A primary contact already exists for this customer.",
    ) {
        super(message);
        this.name = "CustomerContactPrimaryExistsError";
    }
}

export class CustomerContactDeletionError extends Error {
    constructor(message = "Failed to delete customer contact record.") {
        super(message);
        this.name = "CustomerContactDeletionError";
    }
}

export class CustomerContactDeletionNotAllowedError extends Error {
    constructor(
        message = "Customer contact deletion is not permitted because protected references exist.",
    ) {
        super(message);
        this.name = "CustomerContactDeletionNotAllowedError";
    }
}

export class ServiceLocationCreationError extends Error {
    constructor(message = "Failed to create service location record.") {
        super(message);
        this.name = "ServiceLocationCreationError";
    }
}

export class ServiceLocationUpdateError extends Error {
    constructor(message = "Failed to update service location record.") {
        super(message);
        this.name = "ServiceLocationUpdateError";
    }
}

export class ServiceLocationNotFoundError extends Error {
    constructor(message = "Service location not found.") {
        super(message);
        this.name = "ServiceLocationNotFoundError";
    }
}

export class ServiceLocationPrimaryExistsError extends Error {
    constructor(
        message = "A primary service location already exists for this customer.",
    ) {
        super(message);
        this.name = "ServiceLocationPrimaryExistsError";
    }
}

export class ServiceLocationDeletionError extends Error {
    constructor(message = "Failed to delete service location record.") {
        super(message);
        this.name = "ServiceLocationDeletionError";
    }
}

export class ServiceLocationDeletionNotAllowedError extends Error {
    constructor(
        message = "Service location deletion is not permitted because protected references exist.",
    ) {
        super(message);
        this.name = "ServiceLocationDeletionNotAllowedError";
    }
}

