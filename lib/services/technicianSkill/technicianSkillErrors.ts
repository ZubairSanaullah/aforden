/**
 * TechnicianSkill domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers translate these into appropriate HTTP responses.
 */

export class TechnicianSkillNotFoundError extends Error {
    constructor(message = "Technician skill assignment not found.") {
        super(message);
        this.name = "TechnicianSkillNotFoundError";
    }
}

export class TechnicianSkillAlreadyExistsError extends Error {
    constructor(message = "This skill is already assigned to this technician.") {
        super(message);
        this.name = "TechnicianSkillAlreadyExistsError";
    }
}

export class InvalidTechnicianProfileError extends Error {
    constructor(message = "Technician profile not found or does not belong to this workspace.") {
        super(message);
        this.name = "InvalidTechnicianProfileError";
    }
}

export class InvalidSkillAssignmentError extends Error {
    constructor(message = "Skill not found or does not belong to this workspace.") {
        super(message);
        this.name = "InvalidSkillAssignmentError";
    }
}
