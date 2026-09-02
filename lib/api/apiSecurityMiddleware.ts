import { NextRequest, NextResponse } from "next/server";
import {
    extractClientIp,
    checkUnauthenticatedRateLimitSync,
    checkSlidingWindowSync,
    attachRateLimitHeaders,
} from "@/lib/publicApi/rateLimit/rateLimitService";
import crypto from "crypto";

export const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB payload size cap

export interface RouteRateLimitConfig {
    windowMs: number;
    maxRequests: number;
}

/**
 * Per-route-class rate limit thresholds.
 *
 * These values are starting points open to revision:
 * - AUTH_SENSITIVE (10/min): Brute-force/credential-stuffing protection on login,
 *   password-reset, email-resend endpoints. ~1 attempt per 6s per IP. Could be
 *   tightened to 5 if UX allows, or relaxed for mobile clients on slow networks.
 * - MUTATION (60/min): ~1 write/sec sustained per (workspaceId + actor).
 *   Balanced against bulk CRUD operations. May need raising for automation
 *   integrations or batch import flows without a separate API key.
 * - READ (120/min): ~2 req/sec per (workspaceId + actor) for dashboard polling.
 *   Could be differentiated per endpoint (e.g. list vs. detail) if needed.
 * - PLATFORM_ADMIN (120/min): Same as READ — admin actions are infrequent by
 *   design. Could be tightened to 30/min if the admin surface warrants stricter posture.
 *
 * Public API (/api/v1/*) rate limits are NOT governed here — they are enforced
 * by the existing API Key + subscription-plan quota layer (Phase 1.18.1,
 * lib/publicApi/rateLimit/) with per-key (120 req/min) and per-workspace
 * (Starter 300, Growth 1200, Enterprise 6000 req/min) tiers.
 */
export const RATE_LIMIT_CONFIGS = {
    AUTH_SENSITIVE: {
        windowMs: 60 * 1000,
        maxRequests: 10,
    },
    MUTATION: {
        windowMs: 60 * 1000,
        maxRequests: 60,
    },
    READ: {
        windowMs: 60 * 1000,
        maxRequests: 120,
    },
    PLATFORM_ADMIN: {
        windowMs: 60 * 1000,
        maxRequests: 120,
    },
};

/**
 * Hashes an arbitrary string to a fixed-length hex digest for use as a
 * rate-limit bucket key suffix. Keeps raw tokens/IPs out of memory keys.
 */
function hashKey(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex").substring(0, 32);
}

import { applySecurityHeaders } from "@/lib/api/securityHeaders";

function jsonSecurityError(
    code: string,
    message: string,
    status: number,
    headersInit?: Record<string, string>,
): NextResponse {
    const responseHeaders = new Headers(headersInit);
    responseHeaders.set("content-type", "application/json");
    applySecurityHeaders(responseHeaders);

    return new NextResponse(
        JSON.stringify({
            error: {
                code,
                message,
            },
        }),
        {
            status,
            headers: responseHeaders,
        },
    );
}

/**
 * Global API Security Middleware Handler (Synchronous).
 *
 * Enforces:
 * 1. Request Body Size Cap — HTTP 413 for Content-Length > 1MB on POST/PUT/PATCH.
 * 2. Route-class Rate Limiting — HTTP 429 + full RFC header set (Retry-After,
 *    X-RateLimit-Limit/Remaining/Reset) via sliding-window algorithm.
 *
 * Bucket key strategy by route class:
 *  - /api/auth/*         → rl:unauth:ip:{hash(clientIp)}       (10/min per IP)
 *  - /api/platform/*     → rl:rest:platform:{hash(token|ip)}   (120/min per session or IP)
 *  - /api/admin/*        → rl:rest:platform:{hash(token|ip)}   (120/min per session or IP)
 *  - /api/v1/*           → passthrough (handled by API Key quota layer, Phase 1.18.1)
 *  - all other /api/**   → rl:rest:ws:{workspaceId}:{hash(token)} when both workspaceId
 *                          and session token are present (preferred — actor-scoped);
 *                          rl:rest:ws:{workspaceId}:{hash(ip)} when workspaceId present but
 *                          no session token (unauthenticated workspace probe — conservative);
 *                          rl:rest:ip:{hash(ip)} when neither (non-workspace route, e.g.
 *                          /api/public or similar).
 *    Limit: 60/min for write methods (POST/PUT/PATCH/DELETE), 120/min for GET.
 */
export function applyApiSecurityMiddleware(
    request: NextRequest,
): NextResponse | null {
    const { pathname } = request.nextUrl;
    const method = request.method.toUpperCase();

    // -------------------------------------------------------------------------
    // 1. Payload size check — applies to POST, PUT, PATCH only.
    //    DELETE is intentionally excluded (body rarely meaningful on DELETE).
    // -------------------------------------------------------------------------
    if (["POST", "PUT", "PATCH"].includes(method)) {
        const contentLength = request.headers.get("content-length");
        if (contentLength) {
            const lengthBytes = parseInt(contentLength, 10);
            if (!isNaN(lengthBytes) && lengthBytes > MAX_PAYLOAD_BYTES) {
                return jsonSecurityError(
                    "PAYLOAD_TOO_LARGE",
                    `Request payload size (${lengthBytes} bytes) exceeds maximum allowable limit of ${MAX_PAYLOAD_BYTES} bytes (1MB).`,
                    413,
                );
            }
        }
    }

    // -------------------------------------------------------------------------
    // 2. Rate limiting — route classification and bucket key derivation.
    // -------------------------------------------------------------------------
    const clientIp = extractClientIp(request);

    // Extract workspaceId from pathname if present (/api/workspaces/[id]/...)
    const workspaceMatch = pathname.match(/\/api\/workspaces\/([^\/]+)/);
    const workspaceId = workspaceMatch ? workspaceMatch[1] : null;

    // Session token: prefer secure cookie, fall back to Authorization header
    const sessionToken =
        request.cookies.get("authjs.session-token")?.value ??
        request.cookies.get("__Secure-authjs.session-token")?.value ??
        request.headers.get("authorization");

    let rateLimitResult;

    if (pathname.startsWith("/api/auth/")) {
        // -----------------------------------------------------------------------
        // Auth-sensitive endpoints (login, password-reset, resend-verification).
        // Keyed by IP via the original unauthenticated-IP rate-limiter so that
        // the bucket prefix remains `rl:unauth:ip:` — correctly reflecting that
        // these are unauthenticated / pre-authentication requests.
        // -----------------------------------------------------------------------
        rateLimitResult = checkUnauthenticatedRateLimitSync(clientIp, {
            ipLimit: RATE_LIMIT_CONFIGS.AUTH_SENSITIVE.maxRequests,
            windowMs: RATE_LIMIT_CONFIGS.AUTH_SENSITIVE.windowMs,
        });
    } else if (
        pathname.startsWith("/api/platform/") ||
        pathname.startsWith("/api/admin/")
    ) {
        // -----------------------------------------------------------------------
        // Platform admin endpoints — keyed by hashed session token when present,
        // otherwise by IP. Bucket prefix: `rl:rest:platform:`.
        // -----------------------------------------------------------------------
        const keySource = sessionToken ?? clientIp;
        const bucket = `rl:rest:platform:${hashKey(keySource)}`;
        rateLimitResult = checkSlidingWindowSync(bucket, {
            limit: RATE_LIMIT_CONFIGS.PLATFORM_ADMIN.maxRequests,
            windowMs: RATE_LIMIT_CONFIGS.PLATFORM_ADMIN.windowMs,
        });
    } else if (pathname.startsWith("/api/v1/")) {
        // -----------------------------------------------------------------------
        // Public API — entirely handled by the API Key + subscription-plan quota
        // layer (lib/publicApi/rateLimit/, Phase 1.18.1). This middleware returns
        // null here to avoid double-counting and to preserve per-key/per-workspace
        // quota semantics that are specific to the public API contract.
        // -----------------------------------------------------------------------
        return null;
    } else {
        // -----------------------------------------------------------------------
        // General workspace REST API (/api/workspaces/..., /api/work-orders, etc.)
        //
        // Bucket key preference (most specific to least specific):
        //   1. workspaceId + sessionToken → `rl:rest:ws:{wid}:{hash(token)}`
        //      Preferred: independent counters per actor per workspace.
        //   2. workspaceId + IP           → `rl:rest:ws:{wid}:{hash(ip)}`
        //      Fallback when no session: catches unauthenticated workspace probes.
        //   3. IP only                    → `rl:rest:ip:{hash(ip)}`
        //      For non-workspace-scoped routes (catch-all).
        //
        // Limit: mutation methods (POST/PUT/PATCH/DELETE) → 60/min;
        //        read methods (GET, etc.)                 → 120/min.
        // -----------------------------------------------------------------------
        const limit = ["POST", "PUT", "PATCH", "DELETE"].includes(method)
            ? RATE_LIMIT_CONFIGS.MUTATION.maxRequests
            : RATE_LIMIT_CONFIGS.READ.maxRequests;

        let bucket: string;
        if (workspaceId && sessionToken) {
            bucket = `rl:rest:ws:${workspaceId}:${hashKey(sessionToken)}`;
        } else if (workspaceId) {
            bucket = `rl:rest:ws:${workspaceId}:${hashKey(clientIp)}`;
        } else {
            bucket = `rl:rest:ip:${hashKey(clientIp)}`;
        }

        rateLimitResult = checkSlidingWindowSync(bucket, {
            limit,
            windowMs: RATE_LIMIT_CONFIGS.MUTATION.windowMs,
        });
    }

    if (!rateLimitResult.allowed) {
        const responseHeaders = new Headers();
        attachRateLimitHeaders(responseHeaders, rateLimitResult);

        return jsonSecurityError(
            "RATE_LIMIT_EXCEEDED",
            `Rate limit exceeded for endpoint. Please retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
            429,
            Object.fromEntries(responseHeaders.entries()),
        );
    }

    return null;
}
