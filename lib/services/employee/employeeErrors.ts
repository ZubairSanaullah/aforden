/**
 * Employee domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers (API route handlers / Server Actions) translate
 * these into appropriate HTTP responses.
 */

export class EmployeeNotFoundError extends Error {
    constructor(message = "Employee not found.") {
        super(message);
        this.name = "EmployeeNotFoundError";
    }
}

export class WorkspaceMemberNotFoundError extends Error {
    constructor(message = "Workspace member not found.") {
        super(message);
        this.name = "WorkspaceMemberNotFoundError";
    }
}

export class EmployeeAlreadyExistsError extends Error {
    constructor(message = "This workspace member already has an employee profile.") {
        super(message);
        this.name = "EmployeeAlreadyExistsError";
    }
}

export class InvalidWorkspaceMemberError extends Error {
    constructor(message = "Workspace member is invalid or does not belong to this workspace.") {
        super(message);
        this.name = "InvalidWorkspaceMemberError";
    }
}

export class DuplicateEmployeeNumberError extends Error {
    constructor(message = "An employee with this employee number already exists in this workspace.") {
        super(message);
        this.name = "DuplicateEmployeeNumberError";
    }
}
