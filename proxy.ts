import { NextRequest, NextResponse } from "next/server";
import {
    parseApiVersionFromPath,
    SUPPORTED_VERSIONS_HEADER_NAME,
    SUPPORTED_VERSIONS_HEADER_VALUE,
    resolveRequestId,
    REQUEST_ID_HEADER_NAME,
    jsonError,
} from "@/lib/publicApi";
import { applyApiSecurityMiddleware } from "@/lib/api/apiSecurityMiddleware";
import {
    applySecurityHeaders,
    applyPublicApiCorsHeaders,
    handlePublicApiPreflight,
} from "@/lib/api/securityHeaders";

/**
 * Next.js Request Proxy (formerly Middleware) for Global Security, Routing & Transport Hardening.
 *
 * Responsibilities:
 * 1. Attaches canonical browser security headers (CSP, HSTS, X-Frame-Options,
 *    X-Content-Type-Options, Referrer-Policy, Permissions-Policy) across all routes.
 * 2. Manages CORS for Public API (/api/v1/*), including OPTIONS preflight.
 * 3. Enforces API version routing and rejects unsupported versions with HTTP 404.
 * 4. Enforces global API rate limiting & request body size limits (/api/...).
 * 5. Injects standard X-Request-Id header across all API requests.
 */
export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const method = request.method.toUpperCase();

    // 1. Versioned Public API CORS & Routing (/api/v...)
    if (pathname.startsWith("/api/v")) {
        const parsed = parseApiVersionFromPath(pathname);

        if (parsed.isPublicApi) {
            // Handle CORS preflight OPTIONS request
            if (method === "OPTIONS") {
                return handlePublicApiPreflight();
            }

            const rawHeader = request.headers.get(REQUEST_ID_HEADER_NAME);
            const { requestId } = resolveRequestId(rawHeader);

            if (!parsed.isSupported) {
                const errorResponse = jsonError(
                    "API_VERSION_UNSUPPORTED",
                    `The requested API version '${parsed.version}' is not supported. Supported versions: ${SUPPORTED_VERSIONS_HEADER_VALUE}.`,
                    {
                        status: 404,
                        requestId,
                        headers: {
                            [SUPPORTED_VERSIONS_HEADER_NAME]:
                                SUPPORTED_VERSIONS_HEADER_VALUE,
                        },
                    },
                );
                applySecurityHeaders(errorResponse.headers);
                applyPublicApiCorsHeaders(errorResponse.headers);
                return errorResponse;
            }

            const requestHeaders = new Headers(request.headers);
            requestHeaders.set(REQUEST_ID_HEADER_NAME, requestId);

            const response = NextResponse.next({
                request: {
                    headers: requestHeaders,
                },
            });
            response.headers.set(REQUEST_ID_HEADER_NAME, requestId);
            applySecurityHeaders(response.headers);
            applyPublicApiCorsHeaders(response.headers);
            return response;
        }
    }

    // 2. Global REST API Security, Rate Limiting & Body Size Cap (/api/*)
    if (pathname.startsWith("/api/")) {
        const securityResponse = applyApiSecurityMiddleware(request);
        if (securityResponse) {
            // Security error responses (413, 429) already have security headers attached
            return securityResponse;
        }
    }

    // 3. Downstream Response with Canonical Security Headers
    const response = NextResponse.next();
    applySecurityHeaders(response.headers);
    return response;
}

// Backward compatibility alias for legacy imports and existing test suites
export { proxy as middleware };

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
