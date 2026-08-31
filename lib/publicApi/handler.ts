import crypto from "crypto";
import { resolveRequestId, REQUEST_ID_HEADER_NAME } from "./requestId";
import { runWithPublicApiContext, PublicApiContext } from "./context";
import { jsonError } from "./envelope";
import { PublicApiError, STATUS_TO_PUBLIC_ERROR_MAP } from "./errors";
import { authenticatePublicApiRequest, GENERIC_UNAUTHORIZED_MESSAGE } from "./auth";
import { PublicApiScope, hasRequiredScopes } from "./scopes";
import {
    checkAuthenticatedRateLimit,
    checkUnauthenticatedRateLimit,
    attachRateLimitHeaders,
    extractClientIp,
} from "./rateLimit";
import { recordApiRequestLog } from "./logging";

export type PublicApiRouteHandler = (
    request: Request,
    ...args: any[]
) => Promise<Response> | Response;

export interface PublicApiAuthOptions {
    version?: string;
    requiredScopes?: PublicApiScope[];
    scopeMode?: "AND" | "OR";
}

function hashClientIp(ip: string): string {
    return crypto.createHash("sha256").update(ip).digest("hex").substring(0, 32);
}

function getRequestPath(request: Request): string {
    try {
        return new URL(request.url).pathname;
    } catch {
        return request.url;
    }
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
 *    Includes Unauthenticated IP Rate Limiting to prevent brute-force credential abuse.
 * 2. Multi-Tiered Rate Limiting (429 RATE_LIMITED if per-key or per-workspace quota exceeded).
 * 3. Scope Authorization (403 FORBIDDEN if credential lacks required scopes).
 * 4. Execution (Context bound into AsyncLocalStorage and handler called).
 * 5. Response Headers (X-Request-ID, X-RateLimit-* headers attached to all responses).
 * 6. Asynchronous Request & Usage Logging (Fire-and-forget, non-blocking telemetry write).
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
        const startTime = Date.now();
        const rawHeader = request.headers.get(REQUEST_ID_HEADER_NAME);
        const { requestId } = resolveRequestId(rawHeader);
        const clientIp = extractClientIp(request);
        const ipHash = hashClientIp(clientIp);
        const endpoint = getRequestPath(request);
        const method = request.method;
        const userAgent = request.headers.get("user-agent");

        // 1. Authenticate bearer credential (401 before 403)
        const credential = await authenticatePublicApiRequest(request);

        if (!credential) {
            // Track and throttle unauthenticated / failed-auth abuse by client IP
            const unauthResult = await checkUnauthenticatedRateLimit(clientIp);
            if (!unauthResult.allowed) {
                const headers = new Headers();
                attachRateLimitHeaders(headers, unauthResult);
                return jsonError(
                    "RATE_LIMITED",
                    `API rate limit exceeded. Please retry after ${unauthResult.retryAfterSeconds} seconds.`,
                    {
                        status: 429,
                        requestId,
                        headers,
                    },
                );
            }

            return jsonError("UNAUTHORIZED", GENERIC_UNAUTHORIZED_MESSAGE, {
                status: 401,
                requestId,
            });
        }

        // 2. Dual-tiered rate limiting (Tier 1: Per-API-Key, Tier 2: Per-Workspace Aggregate)
        const rateLimitResult = await checkAuthenticatedRateLimit(
            credential.workspaceId,
            credential.apiKeyId,
        );

        if (!rateLimitResult.allowed) {
            const headers = new Headers();
            attachRateLimitHeaders(headers, rateLimitResult);

            // Asynchronous fire-and-forget request log
            void recordApiRequestLog({
                workspaceId: credential.workspaceId,
                apiKeyId: credential.apiKeyId,
                developerApplicationId: credential.developerApplicationId,
                requestId,
                endpoint,
                method,
                statusCode: 429,
                durationMs: Date.now() - startTime,
                ipHash,
                userAgent,
                apiVersion: version,
                rateLimitTier: rateLimitResult.tier,
                errorCode: "RATE_LIMITED",
            });

            return jsonError(
                "RATE_LIMITED",
                `API rate limit exceeded. Please retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
                {
                    status: 429,
                    requestId,
                    headers,
                },
            );
        }

        // 3. Authorize requested scopes (403 with specific scope details)
        if (
            requiredScopes.length > 0 &&
            !hasRequiredScopes(credential.scopes, requiredScopes, scopeMode)
        ) {
            const missingScopes = requiredScopes.filter(
                (s) => !credential.scopes.includes(s),
            );
            const headers = new Headers();
            attachRateLimitHeaders(headers, rateLimitResult);

            // Asynchronous fire-and-forget request log
            void recordApiRequestLog({
                workspaceId: credential.workspaceId,
                apiKeyId: credential.apiKeyId,
                developerApplicationId: credential.developerApplicationId,
                requestId,
                endpoint,
                method,
                statusCode: 403,
                durationMs: Date.now() - startTime,
                ipHash,
                userAgent,
                apiVersion: version,
                rateLimitTier: rateLimitResult.tier,
                errorCode: "FORBIDDEN",
            });

            return jsonError("FORBIDDEN", "Missing required API scope.", {
                status: 403,
                requestId,
                headers,
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
            startTime,
            version,
            auth: credential,
        };

        return runWithPublicApiContext(context, async () => {
            try {
                const response = await handler(request, ...args);

                if (!response.headers.has(REQUEST_ID_HEADER_NAME)) {
                    response.headers.set(REQUEST_ID_HEADER_NAME, requestId);
                }
                attachRateLimitHeaders(response.headers, rateLimitResult);

                const responseErrorCode = response.headers.get("x-aforden-error-code");
                const mappedErrorCode = response.status >= 400
                    ? (responseErrorCode || STATUS_TO_PUBLIC_ERROR_MAP[response.status] || "ERROR")
                    : null;

                // Asynchronous fire-and-forget request log
                void recordApiRequestLog({
                    workspaceId: credential.workspaceId,
                    apiKeyId: credential.apiKeyId,
                    developerApplicationId: credential.developerApplicationId,
                    requestId,
                    endpoint,
                    method,
                    statusCode: response.status,
                    durationMs: Date.now() - startTime,
                    ipHash,
                    userAgent,
                    apiVersion: version,
                    rateLimitTier: rateLimitResult.tier,
                    errorCode: mappedErrorCode,
                });

                return response;
            } catch (error) {
                const headers = new Headers();
                attachRateLimitHeaders(headers, rateLimitResult);

                if (error instanceof PublicApiError) {
                    // Asynchronous fire-and-forget request log
                    void recordApiRequestLog({
                        workspaceId: credential.workspaceId,
                        apiKeyId: credential.apiKeyId,
                        developerApplicationId: credential.developerApplicationId,
                        requestId,
                        endpoint,
                        method,
                        statusCode: error.statusCode,
                        durationMs: Date.now() - startTime,
                        ipHash,
                        userAgent,
                        apiVersion: version,
                        rateLimitTier: rateLimitResult.tier,
                        errorCode: error.code,
                    });

                    return jsonError(error.code, error.message, {
                        status: error.statusCode,
                        details: error.details,
                        requestId,
                        headers,
                        documentationUrl: error.documentationUrl,
                    });
                }

                console.error(`[PublicAPI] Unhandled server error [${requestId}]:`, error);

                // Asynchronous fire-and-forget request log
                void recordApiRequestLog({
                    workspaceId: credential.workspaceId,
                    apiKeyId: credential.apiKeyId,
                    developerApplicationId: credential.developerApplicationId,
                    requestId,
                    endpoint,
                    method,
                    statusCode: 500,
                    durationMs: Date.now() - startTime,
                    ipHash,
                    userAgent,
                    apiVersion: version,
                    rateLimitTier: rateLimitResult.tier,
                    errorCode: "INTERNAL_SERVER_ERROR",
                });

                return jsonError(
                    "INTERNAL_SERVER_ERROR",
                    "An unexpected error occurred processing your request.",
                    {
                        status: 500,
                        requestId,
                        headers,
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
