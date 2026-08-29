import { resolveRequestId, REQUEST_ID_HEADER_NAME } from "./requestId";
import { runWithPublicApiContext, PublicApiContext } from "./context";
import { jsonError } from "./envelope";
import { PublicApiError } from "./errors";
import { authenticatePublicApiRequest, GENERIC_UNAUTHORIZED_MESSAGE } from "./auth";
import { PublicApiScope, hasRequiredScopes } from "./scopes";

export type PublicApiRouteHandler = (
    request: Request,
    ...args: any[]
) => Promise<Response> | Response;

export interface PublicApiAuthOptions {
    version?: string;
    requiredScopes?: PublicApiScope[];
    scopeMode?: "AND" | "OR";
}

/**
 * Higher-order wrapper for unauthenticated Public API route handlers.
 * - Extracts/validates incoming X-Request-Id (or generates a new one)
 * - Establishes the AsyncLocalStorage PublicApiContext
 * - Enforces standard X-Request-Id response header
 * - Sanitizes unhandled exceptions into canonical INTERNAL_SERVER_ERROR envelopes
 */
export function withPublicApiContext(
    handler: PublicApiRouteHandler,
    version: string = "v1",
): PublicApiRouteHandler {
    return async (request: Request, ...args: any[]): Promise<Response> => {
        const rawHeader = request.headers.get(REQUEST_ID_HEADER_NAME);
        const { requestId } = resolveRequestId(rawHeader);

        const context: PublicApiContext = {
            requestId,
            startTime: Date.now(),
            version,
        };

        return runWithPublicApiContext(context, async () => {
            try {
                const response = await handler(request, ...args);

                // Ensure X-Request-Id is attached to outgoing response headers
                if (!response.headers.has(REQUEST_ID_HEADER_NAME)) {
                    response.headers.set(REQUEST_ID_HEADER_NAME, requestId);
                }

                return response;
            } catch (error) {
                if (error instanceof PublicApiError) {
                    return jsonError(error.code, error.message, {
                        status: error.statusCode,
                        details: error.details,
                        requestId,
                        documentationUrl: error.documentationUrl,
                    });
                }

                // Log internal server error for observability (server-side only)
                console.error(`[PublicAPI] Unhandled server error [${requestId}]:`, error);

                // Return sanitized 500 error envelope
                return jsonError(
                    "INTERNAL_SERVER_ERROR",
                    "An unexpected error occurred processing your request.",
                    {
                        status: 500,
                        requestId,
                    },
                );
            }
        });
    };
}

/**
 * Higher-order wrapper for authenticated and authorized Public API route handlers.
 *
 * Execution Order:
 * 1. Authentication (401 UNAUTHORIZED if missing, malformed, expired, revoked, or non-existent).
 * 2. Scope Authorization (403 FORBIDDEN if credential lacks required scopes).
 * 3. Execution (Context bound into AsyncLocalStorage and handler called).
 */
export function withPublicApiAuth(
    handler: PublicApiRouteHandler,
    options?: PublicApiAuthOptions | string,
): PublicApiRouteHandler {
    const opts: PublicApiAuthOptions =
        typeof options === "string" ? { version: options } : options || {};
    const version = opts.version || "v1";
    const requiredScopes = opts.requiredScopes || [];
    const scopeMode = opts.scopeMode || "AND";

    return async (request: Request, ...args: any[]): Promise<Response> => {
        const rawHeader = request.headers.get(REQUEST_ID_HEADER_NAME);
        const { requestId } = resolveRequestId(rawHeader);

        // 1. Authenticate bearer credential (401 before 403)
        const credential = await authenticatePublicApiRequest(request);

        if (!credential) {
            return jsonError("UNAUTHORIZED", GENERIC_UNAUTHORIZED_MESSAGE, {
                status: 401,
                requestId,
            });
        }

        // 2. Authorize requested scopes (403 with specific scope details)
        if (
            requiredScopes.length > 0 &&
            !hasRequiredScopes(credential.scopes, requiredScopes, scopeMode)
        ) {
            const missingScopes = requiredScopes.filter(
                (s) => !credential.scopes.includes(s),
            );
            return jsonError("FORBIDDEN", "Missing required API scope.", {
                status: 403,
                requestId,
                details: [
                    {
                        issue: "INSUFFICIENT_SCOPE",
                        message: `This endpoint requires the following scope(s): [${requiredScopes.join(", ")}]. Granted scope(s): [${credential.scopes.join(", ")}]. Missing: [${missingScopes.join(", ")}].`,
                    },
                ],
            });
        }

        const context: PublicApiContext = {
            requestId,
            startTime: Date.now(),
            version,
            auth: credential,
        };

        return runWithPublicApiContext(context, async () => {
            try {
                const response = await handler(request, ...args);

                if (!response.headers.has(REQUEST_ID_HEADER_NAME)) {
                    response.headers.set(REQUEST_ID_HEADER_NAME, requestId);
                }

                return response;
            } catch (error) {
                if (error instanceof PublicApiError) {
                    return jsonError(error.code, error.message, {
                        status: error.statusCode,
                        details: error.details,
                        requestId,
                        documentationUrl: error.documentationUrl,
                    });
                }

                console.error(`[PublicAPI] Unhandled server error [${requestId}]:`, error);

                return jsonError(
                    "INTERNAL_SERVER_ERROR",
                    "An unexpected error occurred processing your request.",
                    {
                        status: 500,
                        requestId,
                    },
                );
            }
        });
    };
}

/**
 * Convenience wrapper requiring specific scopes for a route handler.
 */
export function requireScopes(
    requiredScopes: PublicApiScope[],
    handler: PublicApiRouteHandler,
    options?: { version?: string; scopeMode?: "AND" | "OR" },
): PublicApiRouteHandler {
    return withPublicApiAuth(handler, {
        version: options?.version,
        requiredScopes,
        scopeMode: options?.scopeMode ?? "AND",
    });
}
