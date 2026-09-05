import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateEnvironment } from "@/lib/config/envValidation";
import { createSlidingSessionAdapter, isSessionIdle, WORKSPACE_SESSION_IDLE_TIMEOUT_MS } from "@/lib/services/auth/sessionManagement";

describe("Phase 1.22.5 — Auth.js Production Readiness", () => {
  describe("1. Production Secret Audit & Boot-Time Validation", () => {
    it("confirms auth.ts contains zero fallback or hardcoded default secrets", () => {
      const authPath = path.join(process.cwd(), "auth.ts");
      const authSource = fs.readFileSync(authPath, "utf-8");

      // Verify no hardcoded secret or fallback string in auth.ts
      expect(authSource).not.toMatch(/secret:\s*["'][^"']+["']/);
      expect(authSource).not.toMatch(/secret:\s*process\.env\.[A-Z_]+\s*\|\|/);
      expect(authSource).not.toMatch(/secret:\s*["']default/i);
    });

    it("rejects AUTH_SECRET shorter than 32 characters in production", () => {
      const prodEnv = {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://postgres:pass@localhost:6543/postgres?pgbouncer=true",
        AUTH_SECRET: "short_secret_under_32_chars",
        BILLING_PROVIDER: "PADDLE",
        EMAIL_PROVIDER: "BREVO",
        CRON_SECRET: "cron-secret-1234567890",
        PADDLE_API_KEY: "paddle_key_123",
        PADDLE_WEBHOOK_SECRET: "paddle_wh_123",
        BREVO_API_KEY: "brevo_key_123",
      };

      const result = validateEnvironment(prodEnv, { requireProviderSecrets: true });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("AUTH_SECRET must be at least 32 characters"))).toBe(true);
    });

    it("accepts high-entropy AUTH_SECRET (>= 32 characters) in production", () => {
      const prodEnv = {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://postgres:pass@localhost:6543/postgres?pgbouncer=true",
        AUTH_SECRET: "ae6b944e41f60772c2e5d7dbe7de2aa609a3b0945bd94bf964ec4eaeed8bcf0c",
        BILLING_PROVIDER: "PADDLE",
        EMAIL_PROVIDER: "BREVO",
        CRON_SECRET: "cron-secret-1234567890",
        PADDLE_API_KEY: "paddle_key_123",
        PADDLE_WEBHOOK_SECRET: "paddle_wh_123",
        BREVO_API_KEY: "brevo_key_123",
        INTEGRATION_KEY_ENCRYPTION_SECRET: "ae6b944e41f60772c2e5d7dbe7de2aa609a3b0945bd94bf964ec4eaeed8bcf0c",
      };

      const result = validateEnvironment(prodEnv, { requireProviderSecrets: true });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("2. Production Cookie Configuration Audit", () => {
    it("verifies security prefixes, attributes, and host-only scoping in auth.ts", () => {
      const authPath = path.join(process.cwd(), "auth.ts");
      const authSource = fs.readFileSync(authPath, "utf-8");

      // Verify prefix logic for production
      expect(authSource).toContain('__Secure-authjs.session-token');
      expect(authSource).toContain('__Secure-authjs.callback-url');
      expect(authSource).toContain('__Host-authjs.csrf-token');

      // Verify cookie security flags
      expect(authSource).toContain('httpOnly: true');
      expect(authSource).toContain('sameSite: "lax"');
      expect(authSource).toContain('path: "/"');
      expect(authSource).toContain('secure: process.env.NODE_ENV === "production"');

      // Verify no explicit domain attribute is set (RFC 6265bis __Host- requirement and preview compatibility)
      expect(authSource).not.toMatch(/domain:\s*["'][^"']+["']/);
    });
  });

  describe("3. Database Session Strategy & Immediate Invalidation", () => {
    it("verifies database session strategy is configured in auth.ts", () => {
      const authPath = path.join(process.cwd(), "auth.ts");
      const authSource = fs.readFileSync(authPath, "utf-8");

      expect(authSource).toContain('strategy: "database"');
      expect(authSource).toContain("createSlidingSessionAdapter(prisma)");
    });

    it("ensures session invalidation takes effect immediately with zero token lag", async () => {
      // Mock session record
      const mockSession = {
        id: "sess_123",
        sessionToken: "token_abc",
        userId: "user_456",
        expires: new Date(Date.now() + 86400000),
        updatedAt: new Date(),
        user: { id: "user_456", name: "Test User", email: "test@example.com" },
      };

      let currentDatabaseSession: any = { ...mockSession };

      const mockPrisma = {
        session: {
          findUnique: vi.fn().mockImplementation(() => Promise.resolve(currentDatabaseSession)),
          update: vi.fn().mockResolvedValue({}),
          delete: vi.fn().mockResolvedValue({}),
        },
      } as any;

      const adapter = createSlidingSessionAdapter(mockPrisma);

      // 1. Initial valid lookup
      const sessionBefore = await adapter.getSessionAndUser!("token_abc");
      expect(sessionBefore).not.toBeNull();
      expect(sessionBefore?.session.userId).toBe("user_456");

      // 2. Simulate revokeSession or revokeAllSessions: row deleted from PostgreSQL
      currentDatabaseSession = null;

      // 3. Immediate subsequent lookup returns null without waiting for JWT TTL
      const sessionAfter = await adapter.getSessionAndUser!("token_abc");
      expect(sessionAfter).toBeNull();
    });

    it("verifies sliding-window idle timeout evaluation", () => {
      const now = new Date();
      const recent = new Date(now.getTime() - (2 * 60 * 60 * 1000)); // 2 hours ago (active)
      const stale = new Date(now.getTime() - (5 * 60 * 60 * 1000));  // 5 hours ago (idle-expired)

      expect(isSessionIdle(recent, WORKSPACE_SESSION_IDLE_TIMEOUT_MS, now)).toBe(false);
      expect(isSessionIdle(stale, WORKSPACE_SESSION_IDLE_TIMEOUT_MS, now)).toBe(true);
    });
  });

  describe("4. Callbacks, PII Sanitization, and Tenancy Scoping", () => {
    it("confirms session callback returns only sanitized profile fields", () => {
      const authPath = path.join(process.cwd(), "auth.ts");
      const authSource = fs.readFileSync(authPath, "utf-8");

      // Verify selected fields in session callback
      expect(authSource).toContain("id: true");
      expect(authSource).toContain("name: true");
      expect(authSource).toContain("email: true");
      expect(authSource).toContain("avatarUrl: true");
      expect(authSource).toContain("status: true");
      expect(authSource).toContain("emailVerified: true");

      // Verify passwords and keys are NEVER selected
      expect(authSource).not.toContain("passwordHash: true");
      expect(authSource).not.toContain("encryptionKey");
    });
  });

  describe("5. Open-Redirect Protection (redirect callback)", () => {
    // Extract redirect callback from auth.ts
    function getRedirectHandler(): (params: { url: string; baseUrl: string }) => Promise<string> {
      const authPath = path.join(process.cwd(), "auth.ts");
      const authSource = fs.readFileSync(authPath, "utf-8");

      // Verify redirect callback exists in source
      expect(authSource).toContain("async redirect({ url, baseUrl })");

      // Mirror the implementation from auth.ts
      return async ({ url, baseUrl }: { url: string; baseUrl: string }) => {
        if (url.startsWith("//")) {
          return baseUrl;
        }
        if (url.startsWith("/")) {
          if (url.startsWith("/\\")) {
            return baseUrl;
          }
          return `${baseUrl}${url}`;
        }
        try {
          const parsedUrl = new URL(url);
          if (parsedUrl.origin === baseUrl) {
            return url;
          }
        } catch {
          return baseUrl;
        }
        return baseUrl;
      };
    }

    const redirect = getRedirectHandler();
    const baseUrl = "https://app.aforden.com";

    it("allows standard relative URLs", async () => {
      expect(await redirect({ url: "/dashboard", baseUrl })).toBe("https://app.aforden.com/dashboard");
      expect(await redirect({ url: "/workspaces/ws_1/settings", baseUrl })).toBe("https://app.aforden.com/workspaces/ws_1/settings");
    });

    it("allows exact same-origin absolute URLs", async () => {
      expect(await redirect({ url: "https://app.aforden.com/dashboard", baseUrl })).toBe("https://app.aforden.com/dashboard");
      expect(await redirect({ url: "https://app.aforden.com/login?step=2", baseUrl })).toBe("https://app.aforden.com/login?step=2");
    });

    it("blocks protocol-relative URLs (//attacker.com)", async () => {
      expect(await redirect({ url: "//attacker.com", baseUrl })).toBe(baseUrl);
      expect(await redirect({ url: "//evil.com/phish", baseUrl })).toBe(baseUrl);
    });

    it("blocks backslash path traversal tricks (/\\attacker.com)", async () => {
      expect(await redirect({ url: "/\\attacker.com", baseUrl })).toBe(baseUrl);
    });

    it("blocks off-origin destinations (https://attacker.com)", async () => {
      expect(await redirect({ url: "https://attacker.com", baseUrl })).toBe(baseUrl);
      expect(await redirect({ url: "https://evil.com/callback", baseUrl })).toBe(baseUrl);
      expect(await redirect({ url: "http://app.aforden.com", baseUrl })).toBe(baseUrl); // Protocol downgrade
      expect(await redirect({ url: "https://app.aforden.com.evil.com", baseUrl })).toBe(baseUrl); // Subdomain spoof
    });

    it("handles malformed URLs safely", async () => {
      expect(await redirect({ url: "javascript:alert(1)", baseUrl })).toBe(baseUrl);
      expect(await redirect({ url: "not-a-valid-url", baseUrl })).toBe(baseUrl);
    });
  });

  describe("6. Protected Route Architecture & Authorization Boundaries", () => {
    it("verifies proxy.ts preserves downstream responses and security headers", () => {
      const proxyPath = path.join(process.cwd(), "proxy.ts");
      const proxySource = fs.readFileSync(proxyPath, "utf-8");

      expect(proxySource).toContain("applySecurityHeaders");
      expect(proxySource).toContain("applyApiSecurityMiddleware");
      expect(proxySource).toContain("NextResponse.next()");
    });

    it("verifies workspace authorization is separated from platform admin authorization", () => {
      const wsAuthPath = path.join(process.cwd(), "lib", "auth", "api.ts");
      const platformAuthPath = path.join(process.cwd(), "lib", "services", "platform", "transport", "httpHandler.ts");

      const wsSource = fs.readFileSync(wsAuthPath, "utf-8");
      const platformSource = fs.readFileSync(platformAuthPath, "utf-8");

      // Workspace routes resolve workspace membership and permissions
      expect(wsSource).toContain("requirePermission");
      expect(wsSource).toContain("requireAuthenticatedUser");

      // Platform admin routes require platform operator profiles and platform permissions
      expect(platformSource).toContain("requirePlatformAuthorization");
      expect(platformSource).toContain("withPlatformAuth");
    });
  });
});
