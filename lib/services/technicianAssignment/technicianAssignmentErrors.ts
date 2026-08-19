export class TechnicianAssignmentNotFoundError extends Error {
    constructor(
        message = "Technician assignment not found in this workspace.",
    ) {
        super(message);
        this.name = "TechnicianAssignmentNotFoundError";
    }
}

export class TechnicianAssignmentAlreadyExistsError extends Error {
    constructor(
        message = "An active assignment already exists for this technician and work reference.",
    ) {
        super(message);
        this.name = "TechnicianAssignmentAlreadyExistsError";
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

export class TechnicianNotEligibleForAssignmentError extends Error {
    public readonly blockers: string[];

    constructor(
        message = "Technician is not eligible for this assignment.",
        blockers: string[] = [],
    ) {
        super(message);
        this.name = "TechnicianNotEligibleForAssignmentError";
        this.blockers = blockers;
    }
}

export class TechnicianAssignmentOverlapError extends Error {
    constructor(
        message = "Technician already has an active assignment overlapping this time interval.",
    ) {
        super(message);
        this.name = "TechnicianAssignmentOverlapError";
    }
}

export class InvalidAssignmentTimeError extends Error {
    constructor(
        message = "Assignment start time must be strictly earlier than end time.",
    ) {
        super(message);
        this.name = "InvalidAssignmentTimeError";
    }
}

export class AssignmentInvalidStatusTransitionError extends Error {
    public readonly assignmentId: string;
    public readonly currentStatus: string;
    public readonly requestedStatus: string;

    constructor(
        assignmentId: string,
        currentStatus: string,
        requestedStatus: string,
        message = `Cannot transition assignment ${assignmentId} from ${currentStatus} to ${requestedStatus}.`,
    ) {
        super(message);
        this.name = "AssignmentInvalidStatusTransitionError";
        this.assignmentId = assignmentId;
        this.currentStatus = currentStatus;
        this.requestedStatus = requestedStatus;
    }
}

export class AssignmentImmutableError extends Error {
    public readonly assignmentId: string;
    public readonly status: string;

    constructor(
        assignmentId: string,
        status: string,
        message = `Assignment ${assignmentId} is in terminal status ${status} and cannot be modified.`,
    ) {
        super(message);
        this.name = "AssignmentImmutableError";
        this.assignmentId = assignmentId;
        this.status = status;
    }
}
