/**
 * Phase 1.20.8 — Security Headers, Transport Hardening & Cookie Posture Suite
 *
 * Mechanically asserts:
 * 1. Canonical Security Headers applied across all application planes:
 *    - /api/workspaces/* (Workspace Plane)
 *    - /api/v1/* (Public API Plane)
 *    - /api/platform/* (Platform Admin Plane)
 *    - Rendered pages / web routes
 *    - Early security middleware responses (413 Payload Too Large, 429 Rate Limit, 404 Version Unsupported)
 * 2. CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy directives.
 *    - Verifies 'unsafe-eval' is dropped in production CSP and only conditionally allowed in dev.
 * 3. CORS Posture on Public API (wildcard allowed, no credentials) vs Webhooks/Internal routes.
 * 4. Runtime Cookie Serialization: Executes actual Auth.js request handling to assert the
 *    literal Set-Cookie response header strings (HttpOnly, SameSite=Lax, Secure, __Secure- and __Host- prefixes)
 *    across CSRF token generation and live user sign-in session-token issuance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { Auth } from "@auth/core";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { middleware, proxy } from "@/proxy";
import {
  SECURITY_HEADERS,
  PUBLIC_API_CORS_HEADERS,
  getCspHeader,
  applySecurityHeaders,
  applyPublicApiCorsHeaders,
  handlePublicApiPreflight,
} from "@/lib/api/securityHeaders";
import { applyApiSecurityMiddleware, MAX_PAYLOAD_BYTES, RATE_LIMIT_CONFIGS } from "@/lib/api/apiSecurityMiddleware";
import { defaultMemoryRateLimitStore } from "@/lib/publicApi/rateLimit/memoryRateLimitStore";

describe("Phase 1.20.8 — Security Headers, Transport Hardening & Cookie Posture", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await defaultMemoryRateLimitStore.clear();
  });

  // =========================================================================
  // 1. Canonical Security Headers Across Application Planes
  // =========================================================================
  describe("1. Canonical Security Headers Across Planes", () => {
    it("attaches all 6 canonical security headers to internal workspace API routes (/api/workspaces/*)", () => {
      const req = new NextRequest("http://localhost:3000/api/workspaces/ws_acme/work-orders", {
        method: "GET",
      });

      const res = middleware(req);
      expect(res).not.toBeNull();

      expect(res.headers.get("Content-Security-Policy")).toBe(getCspHeader());
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("Permissions-Policy")).toBe(SECURITY_HEADERS["Permissions-Policy"]);
    });

    it("attaches all 6 canonical security headers to Public API routes (/api/v1/*)", () => {
      const req = new NextRequest("http://localhost:3000/api/v1/work-orders", {
        method: "GET",
      });

      const res = middleware(req);
      expect(res).not.toBeNull();

      expect(res.headers.get("Content-Security-Policy")).toBe(getCspHeader());
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("Permissions-Policy")).toBe(SECURITY_HEADERS["Permissions-Policy"]);
    });

    it("attaches all 6 canonical security headers to Platform Admin routes (/api/platform/*)", () => {
      const req = new NextRequest("http://localhost:3000/api/platform/health", {
        method: "GET",
      });

      const res = middleware(req);
      expect(res).not.toBeNull();

      expect(res.headers.get("Content-Security-Policy")).toBe(getCspHeader());
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("Permissions-Policy")).toBe(SECURITY_HEADERS["Permissions-Policy"]);
    });

    it("attaches all 6 canonical security headers to rendered web pages (/dashboard)", () => {
      const req = new NextRequest("http://localhost:3000/dashboard", {
        method: "GET",
      });

      const res = middleware(req);
      expect(res).not.toBeNull();

      expect(res.headers.get("Content-Security-Policy")).toBe(getCspHeader());
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("Permissions-Policy")).toBe(SECURITY_HEADERS["Permissions-Policy"]);
    });

    it("attaches security headers to early 413 Payload Too Large responses", () => {
      const oversizedBytes = MAX_PAYLOAD_BYTES + 500;
      const req = new NextRequest("http://localhost:3000/api/workspaces/ws_acme/work-orders", {
        method: "POST",
        headers: {
          "content-length": String(oversizedBytes),
        },
      });

      const res = middleware(req);
      expect(res.status).toBe(413);

      expect(res.headers.get("Content-Security-Policy")).toBe(getCspHeader());
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("attaches security headers to early 429 Rate Limit Exceeded responses", () => {
      const clientIp = "198.51.100.88";
      const targetUrl = "http://localhost:3000/api/workspaces/ws_acme/work-orders";

      for (let i = 0; i < RATE_LIMIT_CONFIGS.MUTATION.maxRequests; i++) {
        const r = new NextRequest(targetUrl, {
          method: "POST",
          headers: { "x-forwarded-for": clientIp, "content-length": "10" },
        });
        middleware(r);
      }

      const overLimitReq = new NextRequest(targetUrl, {
        method: "POST",
        headers: { "x-forwarded-for": clientIp, "content-length": "10" },
      });

      const res = middleware(overLimitReq);
      expect(res.status).toBe(429);

      expect(res.headers.get("Content-Security-Policy")).toBe(getCspHeader());
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("attaches security headers to 404 Unsupported API Version responses", () => {
      const req = new NextRequest("http://localhost:3000/api/v999/work-orders", {
        method: "GET",
      });

      const res = middleware(req);
      expect(res.status).toBe(404);

      expect(res.headers.get("Content-Security-Policy")).toBe(getCspHeader());
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });
  });

  // =========================================================================
  // 2. CSP unsafe-eval Stripping & Directive Scoping
  // =========================================================================
  describe("2. Security Header Directives & CSP unsafe-eval Environment Gating", () => {
    it("drops 'unsafe-eval' from production CSP while preserving 'unsafe-inline' for SSR hydration", () => {
      const prodCsp = getCspHeader(false); // isDev = false (Production)

      expect(prodCsp).toContain("default-src 'self'");
      expect(prodCsp).toContain("script-src 'self' 'unsafe-inline';");
      expect(prodCsp).not.toContain("unsafe-eval"); // Strictly prohibited in production
      expect(prodCsp).toContain("style-src 'self' 'unsafe-inline'");
      expect(prodCsp).toContain("img-src 'self' data: blob: https:");
      expect(prodCsp).toContain("font-src 'self' data:");
      expect(prodCsp).toContain("connect-src 'self' https:");
      expect(prodCsp).toContain("frame-ancestors 'none'");
      expect(prodCsp).toContain("base-uri 'self'");
      expect(prodCsp).toContain("form-action 'self'");
      expect(prodCsp).toContain("object-src 'none'");
    });

    it("permits 'unsafe-eval' conditionally in development for HMR / webpack eval source maps", () => {
      const devCsp = getCspHeader(true); // isDev = true (Development)
      expect(devCsp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval';");
    });

    it("enforces HSTS with 1-year max-age and includeSubDomains (excluding preload judgment call)", () => {
      const hsts = SECURITY_HEADERS["Strict-Transport-Security"];
      expect(hsts).toContain("max-age=31536000");
      expect(hsts).toContain("includeSubDomains");
      expect(hsts).not.toContain("preload");
    });

    it("restricts unused hardware features in Permissions-Policy", () => {
      const policy = SECURITY_HEADERS["Permissions-Policy"];
      expect(policy).toContain("camera=()");
      expect(policy).toContain("microphone=()");
      expect(policy).toContain("geolocation=()");
      expect(policy).toContain("usb=()");
      expect(policy).toContain("screen-wake-lock=()");
      expect(policy).toContain("payment=(self)");
    });
  });

  // =========================================================================
  // 3. CORS Posture Verification
  // =========================================================================
  describe("3. CORS Posture on Public API vs Internal & Webhook Routes", () => {
    it("handles Public API preflight OPTIONS with HTTP 204 and wildcard origin without credentials", () => {
      const req = new NextRequest("http://localhost:3000/api/v1/work-orders", {
        method: "OPTIONS",
        headers: {
          origin: "https://third-party-dashboard.example.com",
          "access-control-request-method": "GET",
        },
      });

      const res = middleware(req);
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
      expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });

    it("attaches Public API CORS headers on GET requests to /api/v1/* without credentials flag", () => {
      const req = new NextRequest("http://localhost:3000/api/v1/work-orders", {
        method: "GET",
        headers: {
          origin: "https://client-app.example.com",
        },
      });

      const res = middleware(req);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });

    it("does not attach wildcard CORS origin to internal workspace routes", () => {
      const req = new NextRequest("http://localhost:3000/api/workspaces/ws_acme/work-orders", {
        method: "GET",
        headers: {
          origin: "https://attacker-origin.example.com",
        },
      });

      const res = middleware(req);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });

    it("does not attach wildcard CORS origin to webhook receivers", () => {
      const req = new NextRequest("http://localhost:3000/api/billing/webhooks/stripe", {
        method: "POST",
        headers: {
          origin: "https://attacker-origin.example.com",
        },
      });

      const res = middleware(req);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });
  });

  // =========================================================================
  // 4. Runtime Cookie Serialization & Set-Cookie Header Verification
  // =========================================================================
  describe("4. Runtime Cookie Serialization (Actual Set-Cookie Header Inspection)", () => {
    const mockPrisma = {
      user: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
      account: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
      session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
      verificationToken: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    } as any;

    it("emits actual Set-Cookie header for __Host-authjs.csrf-token and __Secure-authjs.callback-url in production", async () => {
      const prodConfig = {
        basePath: "/api/auth",
        trustHost: true,
        secret: "super_secret_test_key_minimum_32_characters_123456789",
        session: { strategy: "jwt" as const },
        cookies: {
          sessionToken: {
            name: "__Secure-authjs.session-token",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: true,
            },
          },
          csrfToken: {
            name: "__Host-authjs.csrf-token",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: true,
            },
          },
          callbackUrl: {
            name: "__Secure-authjs.callback-url",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: true,
            },
          },
        },
        providers: [],
      };

      const request = new Request("https://app.aforden.com/api/auth/csrf", {
        method: "GET",
      });

      const response = await Auth(request, prodConfig);
      expect(response.status).toBe(200);

      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).not.toBeNull();
      expect(setCookie).toContain("__Host-authjs.csrf-token");
      expect(setCookie).toContain("__Secure-authjs.callback-url");
      expect(setCookie?.toLowerCase()).toContain("httponly");
      expect(setCookie?.toLowerCase()).toContain("samesite=lax");
      expect(setCookie?.toLowerCase()).toContain("secure");
      expect(setCookie).toContain("Path=/");
    });

    it("emits actual Set-Cookie header for __Secure-authjs.session-token with HttpOnly, SameSite=Lax, and Secure on production sign-in callback", async () => {
      const prodConfig = {
        basePath: "/api/auth",
        trustHost: true,
        secret: "super_secret_test_key_minimum_32_characters_123456789",
        session: { strategy: "jwt" as const },
        cookies: {
          sessionToken: {
            name: "__Secure-authjs.session-token",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: true,
            },
          },
          csrfToken: {
            name: "__Host-authjs.csrf-token",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: true,
            },
          },
          callbackUrl: {
            name: "__Secure-authjs.callback-url",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: true,
            },
          },
        },
        providers: [
          {
            id: "credentials",
            name: "Credentials",
            type: "credentials" as const,
            credentials: {},
            authorize: async () => ({ id: "usr_123", name: "Test User", email: "test@aforden.com" }),
          },
        ],
      };

      // 1. Fetch CSRF token
      const csrfReq = new Request("https://app.aforden.com/api/auth/csrf", { method: "GET" });
      const csrfRes = await Auth(csrfReq, prodConfig);
      const csrfCookies = csrfRes.headers.get("set-cookie") || "";
      const csrfTokenMatch = csrfCookies.match(/__Host-authjs\.csrf-token=([^;]+)/);
      const rawCsrfToken = csrfTokenMatch ? decodeURIComponent(csrfTokenMatch[1]).split("|")[0] : "";

      // 2. Execute Credentials sign-in POST
      const body = new URLSearchParams({
        csrfToken: rawCsrfToken,
        email: "test@aforden.com",
        password: "Password123!",
      });

      const signinReq = new Request("https://app.aforden.com/api/auth/callback/credentials", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: csrfCookies,
        },
        body: body.toString(),
      });

      const signinRes = await Auth(signinReq, prodConfig);
      expect(signinRes.status).toBe(302); // Standard Auth.js signin redirect

      const signinCookies = signinRes.headers.get("set-cookie");
      expect(signinCookies).not.toBeNull();

      // Literal sessionToken cookie assertions
      expect(signinCookies).toContain("__Secure-authjs.session-token");
      expect(signinCookies?.toLowerCase()).toContain("httponly");
      expect(signinCookies?.toLowerCase()).toContain("samesite=lax");
      expect(signinCookies?.toLowerCase()).toContain("secure");
      expect(signinCookies).toContain("Path=/");
    });

    it("emits standard development cookie names without Secure in local development environment", async () => {
      const devConfig = {
        basePath: "/api/auth",
        trustHost: true,
        secret: "super_secret_test_key_minimum_32_characters_123456789",
        session: { strategy: "jwt" as const },
        cookies: {
          sessionToken: {
            name: "authjs.session-token",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: false,
            },
          },
          csrfToken: {
            name: "authjs.csrf-token",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: false,
            },
          },
          callbackUrl: {
            name: "authjs.callback-url",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: false,
            },
          },
        },
        providers: [],
      };

      const request = new Request("http://localhost:3000/api/auth/csrf", {
        method: "GET",
      });

      const response = await Auth(request, devConfig);
      expect(response.status).toBe(200);

      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).not.toBeNull();
      expect(setCookie).toContain("authjs.csrf-token");
      expect(setCookie).toContain("authjs.callback-url");
      expect(setCookie?.toLowerCase()).toContain("httponly");
      expect(setCookie?.toLowerCase()).toContain("samesite=lax");
    });

    it("emits actual Set-Cookie header for authjs.session-token without Secure on development sign-in callback", async () => {
      const devConfig = {
        basePath: "/api/auth",
        trustHost: true,
        secret: "super_secret_test_key_minimum_32_characters_123456789",
        session: { strategy: "jwt" as const },
        cookies: {
          sessionToken: {
            name: "authjs.session-token",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: false,
            },
          },
          csrfToken: {
            name: "authjs.csrf-token",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: false,
            },
          },
          callbackUrl: {
            name: "authjs.callback-url",
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: false,
            },
          },
        },
        providers: [
          {
            id: "credentials",
            name: "Credentials",
            type: "credentials" as const,
            credentials: {},
            authorize: async () => ({ id: "usr_123", name: "Test User", email: "test@aforden.com" }),
          },
        ],
      };

      const csrfReq = new Request("http://localhost:3000/api/auth/csrf", { method: "GET" });
      const csrfRes = await Auth(csrfReq, devConfig);
      const csrfCookies = csrfRes.headers.get("set-cookie") || "";
      const csrfTokenMatch = csrfCookies.match(/authjs\.csrf-token=([^;]+)/);
      const rawCsrfToken = csrfTokenMatch ? decodeURIComponent(csrfTokenMatch[1]).split("|")[0] : "";

      const body = new URLSearchParams({
        csrfToken: rawCsrfToken,
        email: "test@aforden.com",
        password: "Password123!",
      });

      const signinReq = new Request("http://localhost:3000/api/auth/callback/credentials", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: csrfCookies,
        },
        body: body.toString(),
      });

      const signinRes = await Auth(signinReq, devConfig);
      expect(signinRes.status).toBe(302);

      const signinCookies = signinRes.headers.get("set-cookie");
      expect(signinCookies).not.toBeNull();
      expect(signinCookies).toContain("authjs.session-token");
      expect(signinCookies?.toLowerCase()).toContain("httponly");
      expect(signinCookies?.toLowerCase()).toContain("samesite=lax");
    });
  });
});
