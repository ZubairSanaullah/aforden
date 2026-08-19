/**
 * Department domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers translate these into appropriate HTTP responses.
 */

export class DepartmentNotFoundError extends Error {
    constructor(message = "Department not found.") {
        super(message);
        this.name = "DepartmentNotFoundError";
    }
}

export class DepartmentAlreadyExistsError extends Error {
    constructor(message = "A department with this name already exists in this workspace.") {
        super(message);
        this.name = "DepartmentAlreadyExistsError";
    }
}

export class DepartmentHasAssignedEmployeesError extends Error {
    constructor(message = "Cannot delete department while employees are assigned to it.") {
        super(message);
        this.name = "DepartmentHasAssignedEmployeesError";
    }
}

export class InvalidDepartmentError extends Error {
    constructor(message = "Department is invalid or does not belong to this workspace.") {
        super(message);
        this.name = "InvalidDepartmentError";
    }
}
