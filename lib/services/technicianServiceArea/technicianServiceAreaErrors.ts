/**
 * TechnicianServiceArea domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers translate these into appropriate HTTP responses.
 */

export class TechnicianServiceAreaNotFoundError extends Error {
    constructor(message = "Technician service area assignment not found.") {
        super(message);
        this.name = "TechnicianServiceAreaNotFoundError";
    }
}

export class TechnicianServiceAreaAlreadyExistsError extends Error {
    constructor(message = "This service area is already assigned to this technician.") {
        super(message);
        this.name = "TechnicianServiceAreaAlreadyExistsError";
    }
}

export class InvalidTechnicianProfileError extends Error {
    constructor(message = "Technician profile not found or does not belong to this workspace.") {
        super(message);
        this.name = "InvalidTechnicianProfileError";
    }
}

export class InvalidServiceAreaAssignmentError extends Error {
    constructor(message = "Service area not found or does not belong to this workspace.") {
        super(message);
        this.name = "InvalidServiceAreaAssignmentError";
    }
}
