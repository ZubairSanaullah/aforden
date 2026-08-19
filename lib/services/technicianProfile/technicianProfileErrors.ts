/**
 * TechnicianProfile domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers translate these into appropriate HTTP responses.
 */

export class TechnicianProfileNotFoundError extends Error {
    constructor(message = "Technician profile not found.") {
        super(message);
        this.name = "TechnicianProfileNotFoundError";
    }
}

export class TechnicianProfileAlreadyExistsError extends Error {
    constructor(message = "This employee already has a technician profile.") {
        super(message);
        this.name = "TechnicianProfileAlreadyExistsError";
    }
}

export class InvalidEmployeeError extends Error {
    constructor(message = "Employee not found or does not belong to this workspace.") {
        super(message);
        this.name = "InvalidEmployeeError";
    }
}
