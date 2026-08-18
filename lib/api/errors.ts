import { authorizationErrorResponse } from "@/lib/auth/api";

/**
 * Converts known authorization errors into HTTP responses.
 *
 * Returns null for errors that are not authorization-related,
 * allowing the route to handle unexpected application errors
 * separately.
 */
export function handleApiError(
    error: unknown,
): Response | null {
    return authorizationErrorResponse(error);
}