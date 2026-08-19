/**
 * ServiceArea domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers translate these into appropriate HTTP responses.
 */

export class ServiceAreaNotFoundError extends Error {
    constructor(message = "Service area not found.") {
        super(message);
        this.name = "ServiceAreaNotFoundError";
    }
}

export class ServiceAreaAlreadyExistsError extends Error {
    constructor(message = "A service area with this name already exists in this workspace.") {
        super(message);
        this.name = "ServiceAreaAlreadyExistsError";
    }
}

export class ServiceAreaHasAssignedTechniciansError extends Error {
    constructor(message = "Cannot delete service area while technicians are assigned to it.") {
        super(message);
        this.name = "ServiceAreaHasAssignedTechniciansError";
    }
}

export class InvalidServiceAreaError extends Error {
    constructor(message = "Service area is invalid or does not belong to this workspace.") {
        super(message);
        this.name = "InvalidServiceAreaError";
    }
}

export class InactiveServiceAreaAssignmentError extends Error {
    constructor(message = "Cannot assign an inactive service area.") {
        super(message);
        this.name = "InactiveServiceAreaAssignmentError";
    }
}
