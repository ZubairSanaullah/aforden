/**
 * Invitation-specific application errors.
 *
 * These are domain errors — they do not contain HTTP status codes.
 * API route handlers translate these into appropriate HTTP responses.
 */

export class InvitationNotFoundError extends Error {
    constructor(
        message = "Invitation not found.",
    ) {
        super(message);
        this.name = "InvitationNotFoundError";
    }
}

export class InvitationExpiredError extends Error {
    constructor(
        message = "This invitation has expired.",
    ) {
        super(message);
        this.name = "InvitationExpiredError";
    }
}

export class InvitationAlreadyAcceptedError extends Error {
    constructor(
        message = "This invitation has already been accepted.",
    ) {
        super(message);
        this.name = "InvitationAlreadyAcceptedError";
    }
}

export class InvitationRevokedError extends Error {
    constructor(
        message = "This invitation has been cancelled.",
    ) {
        super(message);
        this.name = "InvitationRevokedError";
    }
}

export class InvitationEmailMismatchError extends Error {
    constructor(
        message = "This invitation was sent to a different email address.",
    ) {
        super(message);
        this.name = "InvitationEmailMismatchError";
    }
}

export class InvitationAlreadyMemberError extends Error {
    constructor(
        message = "This user is already a member of the workspace.",
    ) {
        super(message);
        this.name = "InvitationAlreadyMemberError";
    }
}

export class InvitationRateLimitError extends Error {
    readonly retryAfterSeconds: number;

    constructor(
        retryAfterSeconds: number,
        message = "Too many invitation requests. Please try again later.",
    ) {
        super(message);
        this.name = "InvitationRateLimitError";
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

export class InvitationInvalidRoleError extends Error {
    constructor(
        message = "The specified role is not valid.",
    ) {
        super(message);
        this.name = "InvitationInvalidRoleError";
    }
}
