/**
 * Technician Operations domain-specific application errors.
 *
 * These are pure domain errors following Aforden's error architecture.
 * Higher-level HTTP adapters translate these into standardized JSON responses.
 * (Section 10 of Phase 1.9.1 architecture contract)
 */

export class TechnicianProfileNotFoundError extends Error {
    constructor(
        message = "Technician profile not found or inactive in the target workspace."
    ) {
        super(message);
        this.name = "TechnicianProfileNotFoundError";
    }
}

export class TechnicianNotAssignedToWorkOrderError extends Error {
    constructor(
        message = "You are not assigned to execute this work order."
    ) {
        super(message);
        this.name = "TechnicianNotAssignedToWorkOrderError";
    }
}

export class ActiveTimeEntryExistsError extends Error {
    constructor(
        message = "An active time entry is already in progress for this technician."
    ) {
        super(message);
        this.name = "ActiveTimeEntryExistsError";
    }
}

export class TimeEntryNotFoundError extends Error {
    constructor(
        message = "Technician time entry not found in the target workspace."
    ) {
        super(message);
        this.name = "TimeEntryNotFoundError";
    }
}

export class TimeEntryImmutableError extends Error {
    constructor(
        message = "Completed time entries are immutable and cannot be modified."
    ) {
        super(message);
        this.name = "TimeEntryImmutableError";
    }
}
