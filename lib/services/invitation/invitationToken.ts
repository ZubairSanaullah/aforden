import crypto from "crypto";

/**
 * Invitation tokens expire after 7 days.
 *
 * Password reset tokens are short-lived (30 min) because the user
 * is actively resetting. Invitations are an async process — a
 * reasonable window is needed for the invitee to respond.
 */
export const INVITATION_EXPIRY_DAYS = 7;

/**
 * Generates a cryptographically secure random raw invitation token.
 *
 * The raw token MUST NOT be stored in the database.
 * It should only exist long enough to construct the invitation URL
 * that is sent to the invitee via email.
 */
export function generateInvitationToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

/**
 * Creates a SHA-256 hash of a raw invitation token.
 *
 * Only this hash is stored in the database.
 * The hash can be re-derived at acceptance time by hashing the
 * raw token extracted from the URL.
 */
export function hashInvitationToken(rawToken: string): string {
    return crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");
}

/**
 * Returns the expiration Date for a new invitation.
 */
export function createInvitationExpiry(): Date {
    return new Date(
        Date.now() +
        INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
}

/**
 * Returns whether an invitation's expiry has passed.
 */
export function isInvitationExpired(expiresAt: Date): boolean {
    return expiresAt.getTime() <= Date.now();
}
