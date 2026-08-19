/**
 * TechnicianAvailability domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers translate these into appropriate HTTP responses.
 */

export class TechnicianAvailabilityNotFoundError extends Error {
    constructor(message = "Technician availability record not found.") {
        super(message);
        this.name = "TechnicianAvailabilityNotFoundError";
    }
}

export class TechnicianAvailabilityAlreadyExistsError extends Error {
    constructor(
        message = "An identical availability record already exists for this technician.",
    ) {
        super(message);
        this.name = "TechnicianAvailabilityAlreadyExistsError";
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

export class InvalidAvailabilityTimeError extends Error {
    constructor(message = "Start time must be earlier than end time.") {
        super(message);
        this.name = "InvalidAvailabilityTimeError";
    }
}

export class InvalidAvailabilityDayError extends Error {
    constructor(message = "Invalid day of week.") {
        super(message);
        this.name = "InvalidAvailabilityDayError";
    }
}

export class AvailabilityOverlapError extends Error {
    constructor(
        message = "The requested availability window overlaps with an existing active schedule window.",
    ) {
        super(message);
        this.name = "AvailabilityOverlapError";
    }
}
