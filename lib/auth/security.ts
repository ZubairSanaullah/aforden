/**
 * Aforden authorization and tenant-isolation security rules.
 *
 * These rules document and centralize the security assumptions
 * used throughout the backend.
 */

export const SECURITY_RULES = {
    /**
     * Every workspace-owned resource must be scoped to a workspace.
     */
    REQUIRE_WORKSPACE_SCOPE: true,

    /**
     * Workspace membership must be ACTIVE before accessing
     * workspace resources.
     */
    REQUIRE_ACTIVE_MEMBERSHIP: true,

    /**
     * Client-provided user IDs must never be trusted for
     * authorization decisions.
     */
    NEVER_TRUST_CLIENT_USER_ID: true,

    /**
     * Client-provided roles must never be trusted.
     */
    NEVER_TRUST_CLIENT_ROLE: true,

    /**
     * Permission checks must be performed server-side.
     */
    REQUIRE_SERVER_SIDE_AUTHORIZATION: true,

    /**
     * Authorization failures must not expose internal
     * role or permission configuration.
     */
    HIDE_AUTHORIZATION_DETAILS: true,

    /**
     * Sliding-window idle timeout for workspace user sessions (4 hours).
     */
    WORKSPACE_SESSION_IDLE_TIMEOUT_MS: 4 * 60 * 60 * 1000,
} as const;