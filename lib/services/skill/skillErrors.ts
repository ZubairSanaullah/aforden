/**
 * Skill domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers translate these into appropriate HTTP responses.
 */

export class SkillNotFoundError extends Error {
    constructor(message = "Skill not found.") {
        super(message);
        this.name = "SkillNotFoundError";
    }
}

export class SkillAlreadyExistsError extends Error {
    constructor(message = "A skill with this name already exists in this workspace.") {
        super(message);
        this.name = "SkillAlreadyExistsError";
    }
}

export class SkillHasAssignedTechniciansError extends Error {
    constructor(message = "Cannot delete skill while technicians are assigned to it.") {
        super(message);
        this.name = "SkillHasAssignedTechniciansError";
    }
}

export class InvalidSkillError extends Error {
    constructor(message = "Skill is invalid or does not belong to this workspace.") {
        super(message);
        this.name = "InvalidSkillError";
    }
}

export class InactiveSkillAssignmentError extends Error {
    constructor(message = "Cannot assign an inactive skill.") {
        super(message);
        this.name = "InactiveSkillAssignmentError";
    }
}
