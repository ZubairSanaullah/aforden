import { NextRequest, NextResponse } from "next/server";
import {
    parseApiVersionFromPath,
    SUPPORTED_VERSIONS_HEADER_NAME,
    SUPPORTED_VERSIONS_HEADER_VALUE,
    resolveRequestId,
    REQUEST_ID_HEADER_NAME,
    jsonError,
} from "@/lib/publicApi";

/**
 * Next.js Edge / Request Middleware for Public API routing.
 *
 * Responsibilities:
 * 1. Intercepts versioned public API requests (/api/v...).
 * 2. Rejects unsupported API versions (e.g. /api/v0, /api/v2) with HTTP 404
 *    and canonical API_VERSION_UNSUPPORTED error contract.
 * 3. Extracts / validates / injects standard X-Request-Id header.
 * 4. Leaves internal /api/... routes completely unaffected.
 */
export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (pathname.startsWith("/api/v")) {
        const parsed = parseApiVersionFromPath(pathname);

        if (parsed.isPublicApi) {
            const rawHeader = request.headers.get(REQUEST_ID_HEADER_NAME);
            const { requestId } = resolveRequestId(rawHeader);

            if (!parsed.isSupported) {
                return jsonError(
                    "API_VERSION_UNSUPPORTED",
                    `The requested API version '${parsed.version}' is not supported. Supported versions: ${SUPPORTED_VERSIONS_HEADER_VALUE}.`,
                    {
                        status: 404,
                        requestId,
                        headers: {
                            [SUPPORTED_VERSIONS_HEADER_NAME]: SUPPORTED_VERSIONS_HEADER_VALUE,
                        },
                    },
                );
            }

            const requestHeaders = new Headers(request.headers);
            requestHeaders.set(REQUEST_ID_HEADER_NAME, requestId);

            const response = NextResponse.next({
                request: {
                    headers: requestHeaders,
                },
            });
            response.headers.set(REQUEST_ID_HEADER_NAME, requestId);
            return response;
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/api/v:path*"],
};
