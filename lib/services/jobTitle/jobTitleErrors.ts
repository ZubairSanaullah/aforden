/**
 * JobTitle domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers translate these into appropriate HTTP responses.
 */

export class JobTitleNotFoundError extends Error {
    constructor(message = "Job title not found.") {
        super(message);
        this.name = "JobTitleNotFoundError";
    }
}

export class JobTitleAlreadyExistsError extends Error {
    constructor(message = "A job title with this name already exists in this workspace.") {
        super(message);
        this.name = "JobTitleAlreadyExistsError";
    }
}

export class JobTitleHasAssignedEmployeesError extends Error {
    constructor(message = "Cannot delete job title while employees are assigned to it.") {
        super(message);
        this.name = "JobTitleHasAssignedEmployeesError";
    }
}

export class InvalidJobTitleError extends Error {
    constructor(message = "Job title is invalid or does not belong to this workspace.") {
        super(message);
        this.name = "InvalidJobTitleError";
    }
}

export class InactiveJobTitleAssignmentError extends Error {
    constructor(message = "Cannot assign an inactive job title.") {
        super(message);
        this.name = "InactiveJobTitleAssignmentError";
    }
}
