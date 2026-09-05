import { NextRequest, NextResponse } from "next/server";

/**
 * Phase 1.20.8 — Security Headers, Transport Hardening & Cookie Posture
 *
 * Canonical Security Headers Configuration & Enforcement.
 * Applied across all application planes (/api/*, /api/v1/*, /api/platform/*, and rendered web pages).
 */

/**
 * Generates the Content-Security-Policy header string.
 *
 * Directives:
 * - default-src 'self'
 * - script-src: In production, strictly 'self' and 'unsafe-inline' (for Next.js client hydration chunks).
 *   'unsafe-eval' is conditionally permitted ONLY in development (NODE_ENV=development) for
 *   webpack/turbopack HMR and eval-based dev source maps, and is strictly stripped in production.
 * - style-src 'self' 'unsafe-inline' (Required by Next.js critical CSS inlining during SSR)
 * - img-src 'self' data: blob: https: (Allows avatars, logos, SVG data URIs, S3 presigned asset URLs)
 * - font-src 'self' data: (Allows web fonts and font icons)
 * - connect-src 'self' https: (Allows API fetch, S3 uploads, Stripe billing, telemetry)
 * - frame-ancestors 'none' (Prevents clickjacking framing across modern browsers)
 * - base-uri 'self' (Prevents <base> tag hijacking)
 * - form-action 'self' (Prevents form submission redirection)
 * - object-src 'none' (Disables Flash/Java applet plugins)
 */
export function getCspHeader(
    isDev: boolean = process.env.NODE_ENV === "development",
): string {
    const scriptSrc = isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval';"
        : "script-src 'self' 'unsafe-inline';";

    return [
        "default-src 'self';",
        scriptSrc,
        "style-src 'self' 'unsafe-inline';",
        "img-src 'self' data: blob: https:;",
        "font-src 'self' data:;",
        "connect-src 'self' https:;",
        "frame-ancestors 'none';",
        "base-uri 'self';",
        "form-action 'self';",
        "object-src 'none';",
    ].join(" ");
}

/**
 * Minimum canonical security header set.
 *
 * 1. Content-Security-Policy (CSP): Dynamic via getCspHeader()
 * 2. Strict-Transport-Security (HSTS): max-age=31536000 (1 year); includeSubDomains
 *    (preload omitted by default as an irrevocable domain-level action)
 * 3. X-Frame-Options: DENY (defense-in-depth for legacy user agents)
 * 4. X-Content-Type-Options: nosniff (prevents MIME-type sniffing)
 * 5. Referrer-Policy: strict-origin-when-cross-origin (protects path/query leakage on HTTPS)
 * 6. Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self), usb=(), screen-wake-lock=()
 */
export const SECURITY_HEADERS: Record<string, string> = {
    "Content-Security-Policy": getCspHeader(),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), payment=(self), usb=(), screen-wake-lock=()",
};

/**
 * Public API CORS Configuration (/api/v1/*).
 *
 * Judgment Call:
 * Public API (/api/v1/*) is an external developer surface authenticated via Bearer API keys.
 * Third-party web dashboards or server scripts may invoke /api/v1/* cross-origin.
 * - Access-Control-Allow-Origin: * (Wildcard is appropriate for API-key authenticated public endpoints).
 * - Access-Control-Allow-Credentials is strictly NOT set (invalid per W3C CORS specification
 *   when using wildcard origin, and prevents credential leakage).
 */
export const PUBLIC_API_CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
        "Authorization, Content-Type, X-Request-Id, Idempotency-Key",
    "Access-Control-Max-Age": "86400",
};

/**
 * Attaches the canonical security header set to a Headers object.
 */
export function applySecurityHeaders(headers: Headers): void {
    const csp = getCspHeader();
    headers.set("Content-Security-Policy", csp);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        if (key !== "Content-Security-Policy") {
            headers.set(key, value);
        }
    }
}

/**
 * Attaches Public API CORS headers to a Headers object.
 */
export function applyPublicApiCorsHeaders(headers: Headers): void {
    for (const [key, value] of Object.entries(PUBLIC_API_CORS_HEADERS)) {
        headers.set(key, value);
    }
}

/**
 * Resolves the appropriate X-Robots-Tag header value for defense-in-depth indexation control (Phase 1.22.9).
 *
 * Directives:
 * 1. Preview Environments: Blanket "noindex, nofollow, noarchive" for *.vercel.app or VERCEL_ENV="preview".
 * 2. Authenticated App Planes & APIs: "noindex, nofollow" for /api/*, /dashboard/*, /work-orders/*, etc.
 * 3. Public Auth Entrypoints: "noindex, follow" for /login, /register, /forgot-password, /reset-password, /verify-email.
 * 4. Public Indexable Pages on Production: null (crawling controlled by robots.txt and sitemap.xml).
 */
export function resolveRobotsTag(
    pathname: string,
    host?: string | null,
    vercelEnv: string | undefined = process.env.VERCEL_ENV
): string | null {
    // 1. Blanket protection for all Vercel preview/branch builds
    const cleanHost = host ? host.split(":")[0].toLowerCase() : null;
    const isVercelPreview =
        vercelEnv === "preview" || (cleanHost ? cleanHost.endsWith(".vercel.app") : false);
    if (isVercelPreview) {
        return "noindex, nofollow, noarchive";
    }

    // 2. Private application planes & backend API routes
    const privatePrefixes = [
        "/api/",
        "/dashboard",
        "/work-orders",
        "/invoices",
        "/quotes",
        "/inventory",
        "/schedules",
        "/customers",
        "/settings",
        "/workspaces",
        "/platform",
        "/technician",
    ];
    if (
        privatePrefixes.some(
            (prefix) =>
                pathname === prefix ||
                pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
        )
    ) {
        return "noindex, nofollow";
    }

    // 3. Public authentication entrypoints
    const authRoutes = [
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
    ];
    if (
        authRoutes.some(
            (route) => pathname === route || pathname.startsWith(`${route}/`),
        )
    ) {
        return "noindex, follow";
    }

    // 4. Public indexable routes (e.g. /)
    return null;
}

/**
 * Attaches the X-Robots-Tag header to a Headers object when applicable.
 */
export function applyIndexationHeaders(
    headers: Headers,
    pathname: string,
    host?: string | null,
    vercelEnv?: string
): void {
    const tag = resolveRobotsTag(pathname, host, vercelEnv);
    if (tag) {
        headers.set("X-Robots-Tag", tag);
    }
}

/**
 * Handles CORS preflight OPTIONS requests for Public API (/api/v1/*).
 * Returns HTTP 204 with security headers and CORS headers.
 */
export function handlePublicApiPreflight(): NextResponse {
    const response = new NextResponse(null, { status: 204 });
    applySecurityHeaders(response.headers);
    applyPublicApiCorsHeaders(response.headers);
    return response;
}


