/**
 * Single source of truth for supported Aforden Public API versions.
 * Aligned with Phase 1.18.1 Architecture Specification Section 3.
 */

export const SUPPORTED_API_VERSIONS = ["v1"] as const;

export type SupportedApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];

export const DEFAULT_API_VERSION: SupportedApiVersion = "v1";

export const SUPPORTED_VERSIONS_HEADER_NAME = "X-Aforden-Supported-Versions";
export const SUPPORTED_VERSIONS_HEADER_VALUE = SUPPORTED_API_VERSIONS.join(", ");

/**
 * Checks whether a given string is a supported API version.
 */
export function isSupportedApiVersion(version: string): version is SupportedApiVersion {
    return (SUPPORTED_API_VERSIONS as readonly string[]).includes(version);
}

/**
 * Analyzes a URL pathname to determine if it targets the public versioned API.
 * Strictly requires the version segment to match 'v' followed exclusively by digits (e.g. 'v1', 'v2').
 * Prevents shadowing internal routes that begin with 'v' (e.g. '/api/vendors', '/api/verify-email').
 *
 * Example paths:
 * - "/api/v1/work-orders" -> { isPublicApi: true, version: "v1", isSupported: true, subPath: "/work-orders" }
 * - "/api/v2/customers"   -> { isPublicApi: true, version: "v2", isSupported: false, subPath: "/customers" }
 * - "/api/vendors"        -> { isPublicApi: false, isSupported: false }
 * - "/api/verify-email"   -> { isPublicApi: false, isSupported: false }
 */
export function parseApiVersionFromPath(pathname: string): {
    isPublicApi: boolean;
    version?: string;
    isSupported: boolean;
    subPath?: string;
} {
    // Strictly match /api/v<digits>(/.*)?
    const match = pathname.match(/^\/api\/(v\d+)(\/.*)?$/);
    if (!match) {
        return { isPublicApi: false, isSupported: false };
    }

    const version = match[1];
    const subPath = match[2] || "/";
    const isSupported = isSupportedApiVersion(version);

    return {
        isPublicApi: true,
        version,
        isSupported,
        subPath,
    };
}
