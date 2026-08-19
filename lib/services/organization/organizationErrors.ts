/**
 * Organization domain-specific application errors.
 *
 * These are pure domain errors — they do not contain HTTP status codes.
 * Higher-level handlers (API route handlers / Server Actions) translate
 * these into appropriate HTTP responses.
 */

export class OrganizationNotFoundError extends Error {
    constructor(message = "Organization not found.") {
        super(message);
        this.name = "OrganizationNotFoundError";
    }
}
