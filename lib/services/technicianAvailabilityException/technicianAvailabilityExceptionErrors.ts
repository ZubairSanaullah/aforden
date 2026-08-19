/**
 * TechnicianAvailabilityException domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers translate these into appropriate HTTP responses.
 */

export class TechnicianAvailabilityExceptionNotFoundError extends Error {
    constructor(
        message = "Technician availability exception not found.",
    ) {
        super(message);
        this.name = "TechnicianAvailabilityExceptionNotFoundError";
    }
}

export class InvalidTechnicianProfileError extends Error {
    constructor(
        message = "Technician profile not found or does not belong to this workspace.",
    ) {
        super(message);
        this.name = "InvalidTechnicianProfileError";
    }
}

export class InvalidExceptionTimeError extends Error {
    constructor(
        message = "Start date/time must be earlier than end date/time.",
    ) {
        super(message);
        this.name = "InvalidExceptionTimeError";
    }
}

export class TechnicianAvailabilityExceptionAlreadyExistsError extends Error {
    constructor(
        message = "An identical availability exception already exists for this technician.",
    ) {
        super(message);
        this.name = "TechnicianAvailabilityExceptionAlreadyExistsError";
    }
}
