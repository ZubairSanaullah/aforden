/**
 * Phase 1.20.5 — API Security & Abuse Protection Test Suite
 *
 * Covers:
 * 1. Rate Limiting (SEC-03)
 *    a. AUTH-LIMIT: 10 req/min per IP on /api/auth/* — asserts 429 status + full RFC header contract
 *    b. WRITE-LIMIT: 60 req/min per (workspaceId+sessionToken) key on mutation routes
 *    c. WRITE-LIMIT KEYING: asserts different (workspaceId+actor) pairs get independent windows
 *    d. READ-LIMIT: 120 req/min on workspace GET routes
 *    e. PUBLIC-API PASSTHROUGH: /api/v1/* returns null (handled by API Key middleware, not this one)
 * 2. Request Payload Size Limits (413)
 *    a. Permits < 1MB
 *    b. Rejects > 1MB with 413 + error code
 * 3. 429 RFC Header Contract: Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * 4. Pagination Cap Verification: mechanical scan of all list Zod schemas for .max(100)
 * 5. File Upload Audit (SEC-02): mechanical scan of app/api + package.json
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
    applyApiSecurityMiddleware,
    MAX_PAYLOAD_BYTES,
    RATE_LIMIT_CONFIGS,
} from "@/lib/api/apiSecurityMiddleware";
import { defaultMemoryRateLimitStore } from "@/lib/publicApi/rateLimit/memoryRateLimitStore";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Helper: build a NextRequest with commonly-needed headers/cookies
// ---------------------------------------------------------------------------
function makeReq(
    url: string,
    method: string,
    opts: {
        ip?: string;
        sessionToken?: string;
        contentLength?: number;
    } = {},
) {
    const headers: Record<string, string> = {};
    if (opts.ip) headers["x-forwarded-for"] = opts.ip;
    if (opts.contentLength !== undefined)
        headers["content-length"] = opts.contentLength.toString();

    const init: Record<string, unknown> = {
        method,
        headers,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = new NextRequest(url, init as any);

    // Inject session-token cookie when requested
    if (opts.sessionToken) {
        // NextRequest doesn't expose a mutable cookie jar directly, so set via header
        Object.defineProperty(req, "cookies", {
            get: () => ({
                get: (name: string) => {
                    if (name === "authjs.session-token")
                        return { value: opts.sessionToken };
                    return undefined;
                },
            }),
        });
    }

    return req;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Phase 1.20.5 — API Security & Abuse Protection Test Suite", () => {
    beforeEach(async () => {
        await defaultMemoryRateLimitStore.clear();
    });

    // =========================================================================
    // 1. Rate Limiting (SEC-03)
    // =========================================================================
    describe("1. Rate Limiting (SEC-03)", () => {

        // -------------------------------------------------------------------------
        // 1a. Auth-sensitive endpoints: 10 req/min per IP
        // Also fully verifies the 429 RFC header contract (Retry-After + X-RateLimit-*)
        // -------------------------------------------------------------------------
        it("AUTH-LIMIT + 429-HEADER-CONTRACT: Enforces 10 req/min on /api/auth/*, returns 429 with full RFC header set", async () => {
            const clientIp = "192.168.1.100";

            for (let i = 0; i < RATE_LIMIT_CONFIGS.AUTH_SENSITIVE.maxRequests; i++) {
                const res = applyApiSecurityMiddleware(
                    makeReq("http://localhost:3000/api/auth/login", "POST", { ip: clientIp }),
                );
                expect(res, `Request ${i + 1} should be allowed`).toBeNull();
            }

            // 11th request must be rejected
            const over = applyApiSecurityMiddleware(
                makeReq("http://localhost:3000/api/auth/login", "POST", { ip: clientIp }),
            );

            // ---- Status ----
            expect(over, "11th request should be rejected").not.toBeNull();
            expect(over!.status).toBe(429);

            // ---- Body ----
            const body = await over!.json();
            expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
            expect(body.error.message).toContain("retry after");

            // ---- X-RateLimit-Limit ----
            const limitHdr = over!.headers.get("x-ratelimit-limit");
            expect(limitHdr, "X-RateLimit-Limit header must be present").not.toBeNull();
            expect(parseInt(limitHdr!, 10)).toBe(RATE_LIMIT_CONFIGS.AUTH_SENSITIVE.maxRequests);

            // ---- X-RateLimit-Remaining ----
            const remainingHdr = over!.headers.get("x-ratelimit-remaining");
            expect(remainingHdr, "X-RateLimit-Remaining header must be present").not.toBeNull();
            expect(parseInt(remainingHdr!, 10)).toBe(0);

            // ---- X-RateLimit-Reset ----
            const resetHdr = over!.headers.get("x-ratelimit-reset");
            expect(resetHdr, "X-RateLimit-Reset header must be present").not.toBeNull();
            const resetEpoch = parseInt(resetHdr!, 10);
            expect(resetEpoch).toBeGreaterThan(Math.floor(Date.now() / 1000));

            // ---- Retry-After ----
            const retryAfterHdr = over!.headers.get("retry-after");
            expect(retryAfterHdr, "Retry-After header must be present on 429").not.toBeNull();
            const retryAfter = parseInt(retryAfterHdr!, 10);
            expect(retryAfter).toBeGreaterThan(0);
            expect(retryAfter).toBeLessThanOrEqual(60); // within the window
        });

        // -------------------------------------------------------------------------
        // 1b. Write (mutation) endpoints: 60 req/min per (workspaceId + sessionToken)
        // This test uses a stable sessionToken cookie so the key is workspace-scoped,
        // not IP-scoped. It also proves that different actors on the same workspace
        // get independent counters (1c below for cross-actor isolation).
        // -------------------------------------------------------------------------
        it("WRITE-LIMIT: Enforces 60 req/min per (workspaceId+actor) key on mutation routes, returns 429", async () => {
            const workspaceId = "ws_abc123";
            const sessionToken = "tok_actor_1";
            const url = `http://localhost:3000/api/workspaces/${workspaceId}/work-orders`;

            for (let i = 0; i < RATE_LIMIT_CONFIGS.MUTATION.maxRequests; i++) {
                const res = applyApiSecurityMiddleware(
                    makeReq(url, "POST", { ip: "10.1.1.1", sessionToken }),
                );
                expect(res, `POST ${i + 1} should be allowed`).toBeNull();
            }

            // 61st request must be rejected
            const over = applyApiSecurityMiddleware(
                makeReq(url, "POST", { ip: "10.1.1.1", sessionToken }),
            );
            expect(over).not.toBeNull();
            expect(over!.status).toBe(429);

            const body = await over!.json();
            expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
        });

        // -------------------------------------------------------------------------
        // 1c. Key isolation: (workspaceId+actorA) and (workspaceId+actorB) are
        // independent counters. Exhausting actorA must NOT affect actorB.
        // -------------------------------------------------------------------------
        it("WRITE-LIMIT KEYING: Different (workspaceId+actor) pairs have independent rate-limit windows", async () => {
            const workspaceId = "ws_isolation";
            const tokenA = "tok_actor_A";
            const tokenB = "tok_actor_B";
            const url = `http://localhost:3000/api/workspaces/${workspaceId}/invoices`;

            // Exhaust actorA
            for (let i = 0; i < RATE_LIMIT_CONFIGS.MUTATION.maxRequests; i++) {
                applyApiSecurityMiddleware(
                    makeReq(url, "POST", { ip: "10.2.2.2", sessionToken: tokenA }),
                );
            }
            const actorABlocked = applyApiSecurityMiddleware(
                makeReq(url, "POST", { ip: "10.2.2.2", sessionToken: tokenA }),
            );
            expect(actorABlocked!.status).toBe(429); // actorA is blocked

            // actorB on the same workspace must still be allowed (fresh counter)
            const actorBFirst = applyApiSecurityMiddleware(
                makeReq(url, "POST", { ip: "10.2.2.3", sessionToken: tokenB }),
            );
            expect(actorBFirst, "actorB must not be affected by actorA's exhaustion").toBeNull();
        });

        // -------------------------------------------------------------------------
        // 1d. Read endpoints: 120 req/min per (workspaceId + actor) key
        // -------------------------------------------------------------------------
        it("READ-LIMIT: Enforces 120 req/min on workspace GET routes", async () => {
            const workspaceId = "ws_read123";
            const sessionToken = "tok_reader";
            const url = `http://localhost:3000/api/workspaces/${workspaceId}/customers`;

            for (let i = 0; i < RATE_LIMIT_CONFIGS.READ.maxRequests; i++) {
                const res = applyApiSecurityMiddleware(
                    makeReq(url, "GET", { ip: "10.3.3.3", sessionToken }),
                );
                expect(res, `GET ${i + 1} should be allowed`).toBeNull();
            }

            // 121st must be rejected
            const over = applyApiSecurityMiddleware(
                makeReq(url, "GET", { ip: "10.3.3.3", sessionToken }),
            );
            expect(over).not.toBeNull();
            expect(over!.status).toBe(429);
        });

        // -------------------------------------------------------------------------
        // 1e. Public API /api/v1/* — middleware returns null (not its concern).
        // Public API rate-limiting is handled by the existing API Key + Subscription
        // Plan quota mechanism in lib/publicApi/rateLimit/ (Phase 1.18.1), not by
        // this global security middleware. This is a design decision: keeping the
        // public API key-keyed rate limiter separate avoids double-counting and
        // preserves the per-key/per-workspace quota logic. This test mechanically
        // verifies the passthrough so there is no accidental interference.
        // -------------------------------------------------------------------------
        it("PUBLIC-API PASSTHROUGH: /api/v1/* is NOT rate-limited by this middleware (handled by API Key quota layer)", () => {
            // 200 requests — all must pass through regardless
            for (let i = 0; i < 200; i++) {
                const res = applyApiSecurityMiddleware(
                    makeReq(
                        `http://localhost:3000/api/v1/work-orders?page=1`,
                        "GET",
                        { ip: "10.5.5.5" },
                    ),
                );
                expect(res, `v1 request ${i + 1} must not be blocked by global middleware`).toBeNull();
            }
        });
    });

    // =========================================================================
    // 2. Request Payload Size Limits (413)
    // =========================================================================
    describe("2. Request Payload Size Limits", () => {
        it("PAYLOAD-LIMIT: Permits mutation requests under 1MB limit", () => {
            const res = applyApiSecurityMiddleware(
                makeReq("http://localhost:3000/api/workspaces/ws_1/work-orders", "POST", {
                    ip: "10.0.0.1",
                    contentLength: 500_000, // ~500 KB
                }),
            );
            expect(res).toBeNull();
        });

        it("PAYLOAD-LIMIT: Rejects mutation requests exceeding 1MB with HTTP 413 + error code", async () => {
            const res = applyApiSecurityMiddleware(
                makeReq("http://localhost:3000/api/workspaces/ws_1/work-orders", "POST", {
                    ip: "10.0.0.2",
                    contentLength: MAX_PAYLOAD_BYTES + 100,
                }),
            );
            expect(res).not.toBeNull();
            expect(res!.status).toBe(413);

            const body = await res!.json();
            expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
            expect(body.error.message).toContain("1MB");
        });

        it("PAYLOAD-LIMIT: GET requests are NOT subject to body size limit even with content-length header", () => {
            // Some proxies forward content-length on GET; middleware must not 413 them
            const res = applyApiSecurityMiddleware(
                makeReq("http://localhost:3000/api/workspaces/ws_1/customers", "GET", {
                    ip: "10.0.0.3",
                    contentLength: MAX_PAYLOAD_BYTES + 1000,
                }),
            );
            // GET is not in [POST, PUT, PATCH] so body limit is not applied
            expect(res).toBeNull();
        });
    });

    // =========================================================================
    // 3. Pagination Cap Verification
    //
    // Design decision: pagination caps are enforced at the Zod schema layer
    // (lib/validations/ and lib/publicApi/*/Validation.ts) via .max(100), not
    // in middleware, so that per-route handlers get validated, typed parameters.
    // Enforcing it in middleware would require parsing query strings for every
    // route, coupling the security layer to route-specific parameter names.
    // This test mechanically confirms every list schema file has the cap.
    // =========================================================================
    describe("3. Pagination Cap Verification (pageSize <= 100 in Zod schemas)", () => {
        it("PAGINATION-CAP: All pageSize/limit definitions in lib/validations and lib/publicApi carry .max(100)", () => {
            const roots = [
                path.join(process.cwd(), "lib", "validations"),
                path.join(process.cwd(), "lib", "publicApi"),
            ];

            const results: Array<{ file: string; line: number; content: string }> = [];

            function scanDir(dir: string) {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        scanDir(full);
                    } else if (entry.name.endsWith(".ts")) {
                        const lines = fs.readFileSync(full, "utf8").split("\n");
                        lines.forEach((line, idx) => {
                            // Match lines that declare pageSize or limit as a coerce/number schema
                            if (/pageSize|[^a-z]limit/.test(line) && /z\.coerce/.test(line)) {
                                results.push({ file: full, line: idx + 1, content: line.trim() });
                            }
                        });
                    }
                }
            }

            for (const root of roots) {
                if (fs.existsSync(root)) scanDir(root);
            }

            expect(results.length).toBeGreaterThan(0); // Must find at least one

            const violations: string[] = [];
            for (const r of results) {
                // The raw definition line alone may not contain max(100) if the schema
                // spans multiple lines. Read the next few lines too.
                const fileLines = fs.readFileSync(r.file, "utf8").split("\n");
                // Read 10 lines ahead to cover fully-indented multi-line Zod chains
                const fragment = fileLines.slice(r.line - 1, r.line + 10).join("\n");
                // Use prefix ".max(100" to match both .max(100) and .max(100, "message") forms
                if (!fragment.includes(".max(100")) {
                    violations.push(`${path.relative(process.cwd(), r.file)}:${r.line} — ${r.content}`);
                }
            }

            expect(
                violations,
                `The following pageSize/limit schemas are missing .max(100):\n${violations.join("\n")}`,
            ).toHaveLength(0);
        });
    });

    // =========================================================================
    // 4. File Upload Audit (SEC-02)
    // Mechanical scan — verbatim equivalent of:
    //   Get-ChildItem app/api -Recurse -Filter *.ts | Select-String "multipart/form-data|formidable|multer|busboy"
    //   Select-String package.json '"multer"|"formidable"|"busboy"|"express-fileupload"'
    // Both returned 0 matches (see SEC-02 Verbatim Evidence in walkthrough).
    // =========================================================================
    describe("4. File Upload Audit (SEC-02)", () => {
        it("SEC-02 AUDIT: Zero file-upload patterns or libraries in app/api or package.json", () => {
            const apiDir = path.join(process.cwd(), "app", "api");
            const UPLOAD_PATTERNS = [
                "multipart/form-data",
                "formidable",
                "multer",
                "busboy",
                "express-fileupload",
            ];

            const hits: Array<{ file: string; pattern: string }> = [];

            function scanDir(dir: string) {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        scanDir(full);
                    } else if (entry.name.endsWith(".ts")) {
                        const content = fs.readFileSync(full, "utf8");
                        for (const pattern of UPLOAD_PATTERNS) {
                            if (content.includes(pattern)) {
                                hits.push({ file: path.relative(process.cwd(), full), pattern });
                            }
                        }
                    }
                }
            }

            scanDir(apiDir);
            expect(
                hits,
                `File upload patterns found in app/api:\n${hits.map((h) => `  ${h.file}: "${h.pattern}"`).join("\n")}`,
            ).toHaveLength(0);

            // Check package.json for upload library dependencies
            const pkgContent = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8");
            const pkgViolations: string[] = [];
            for (const lib of ["multer", "formidable", "busboy", "express-fileupload"]) {
                if (pkgContent.includes(`"${lib}"`)) pkgViolations.push(lib);
            }

            expect(
                pkgViolations,
                `Upload libraries found in package.json: ${pkgViolations.join(", ")}`,
            ).toHaveLength(0);
        });
    });
});
