import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedApiContext,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";

/**
 * GET /api/v1/ping
 *
 * Authenticated and authorized baseline connectivity and health endpoint.
 * Requires `ping:read` scope.
 */
export const GET = withPublicApiAuth(
    async () => {
        const auth = getAuthenticatedApiContext();

        return jsonSuccess({
            status: "ok",
            message: "Aforden Public API v1 is operational",
            application: auth.developerApplicationName,
            environment: auth.environment,
            scopes: auth.scopes,
        });
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.PING_READ],
    },
);
