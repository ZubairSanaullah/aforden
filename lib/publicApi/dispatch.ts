import {
    parseApiVersionFromPath,
    SUPPORTED_VERSIONS_HEADER_NAME,
    SUPPORTED_VERSIONS_HEADER_VALUE,
} from "./versions";
import { resolveRequestId, REQUEST_ID_HEADER_NAME } from "./requestId";
import { jsonError } from "./envelope";

/**
 * Checks whether an incoming request targets an unsupported API version.
 * If the version is unsupported (e.g. /api/v0/... or /api/v2/...), returns
 * the canonical 404 API_VERSION_UNSUPPORTED response with required headers.
 * If the version is supported or not a versioned public API path, returns null.
 */
export function handleApiVersionDispatch(request: Request): Response | null {
    const url = new URL(request.url);
    const parsed = parseApiVersionFromPath(url.pathname);

    // If not a versioned API path, let standard internal / Next.js routing proceed
    if (!parsed.isPublicApi) {
        return null;
    }

    // If version is unsupported (e.g. /api/v0, /api/v2), return canonical 404 error
    if (!parsed.isSupported) {
        const rawHeader = request.headers.get(REQUEST_ID_HEADER_NAME);
        const { requestId } = resolveRequestId(rawHeader);

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

    return null;
}
