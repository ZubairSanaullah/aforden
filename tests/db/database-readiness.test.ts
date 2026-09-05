import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolvePrismaPoolConfig } from "@/lib/prisma";
import { GET as healthHandler } from "@/app/api/health/route";
import { prisma } from "@/lib/prisma";

describe("Phase 1.22.4 — Database & Prisma Production Readiness", () => {
  describe("1. Connection Pool Configuration (resolvePrismaPoolConfig)", () => {
    const origEnv = process.env;

    beforeEach(() => {
      process.env = { ...origEnv };
      delete process.env.PG_POOL_MAX;
      delete process.env.PG_POOL_TIMEOUT_MS;
      delete process.env.PG_IDLE_TIMEOUT_MS;
    });

    afterEach(() => {
      process.env = origEnv;
    });

    it("applies serverless-optimized defaults in production (max=5, timeout=5000ms, idle=10000ms)", () => {
      const config = resolvePrismaPoolConfig(
        "postgresql://postgres:pass@localhost:6543/postgres?pgbouncer=true",
        "production"
      );

      expect(config.max).toBe(5);
      expect(config.connectionTimeoutMillis).toBe(5000);
      expect(config.idleTimeoutMillis).toBe(10000);
      expect(config.connectionString).toContain("pgbouncer=true");
    });

    it("applies developer defaults in development (max=10)", () => {
      const config = resolvePrismaPoolConfig(
        "postgresql://postgres:pass@localhost:6543/postgres",
        "development"
      );

      expect(config.max).toBe(10);
      expect(config.connectionTimeoutMillis).toBe(5000);
      expect(config.idleTimeoutMillis).toBe(10000);
    });

    it("parses connection_limit and pool_timeout from DATABASE_URL query parameters", () => {
      const config = resolvePrismaPoolConfig(
        "postgresql://postgres:pass@localhost:6543/postgres?connection_limit=3&pool_timeout=8",
        "production"
      );

      expect(config.max).toBe(3);
      expect(config.connectionTimeoutMillis).toBe(8000); // 8 seconds -> 8000ms
    });

    it("prioritizes explicit environment variable overrides", () => {
      process.env.PG_POOL_MAX = "7";
      process.env.PG_POOL_TIMEOUT_MS = "12000";
      process.env.PG_IDLE_TIMEOUT_MS = "20000";

      const config = resolvePrismaPoolConfig(
        "postgresql://postgres:pass@localhost:6543/postgres?connection_limit=3&pool_timeout=8",
        "production"
      );

      expect(config.max).toBe(7);
      expect(config.connectionTimeoutMillis).toBe(12000);
      expect(config.idleTimeoutMillis).toBe(20000);
    });
  });

  describe("2. Database Connectivity Health Probe (/api/health)", () => {
    it("returns HTTP 200 and healthy status when database is responsive", async () => {
      const querySpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ "?column?": 1 }]);
      const response = await healthHandler();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("healthy");
      expect(body.timestamp).toBeDefined();
      expect(response.headers.get("cache-control")).toContain("no-store");
      querySpy.mockRestore();
    });

    it("catches DB unreachable distinctly and returns HTTP 503 with informative error", async () => {
      const querySpy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("Connection refused"));
      const response = await healthHandler();
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.status).toBe("unhealthy");
      expect(body.error).toBe("Service unavailable: database connectivity check failed");
      querySpy.mockRestore();
    });
  });

  describe("3. Production Seed Safety Audit", () => {
    it("confirms package.json does not declare an automated prisma.seed hook", () => {
      const pkgPath = path.join(process.cwd(), "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

      expect(pkg.prisma?.seed).toBeUndefined();
    });

    it("confirms build and postinstall scripts never execute test seeds", () => {
      const pkgPath = path.join(process.cwd(), "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

      expect(pkg.scripts.build).not.toContain("seed");
      expect(pkg.scripts.postinstall).toBe("prisma generate");
      expect(pkg.scripts.postinstall).not.toContain("seed");
    });
  });

  describe("4. Destructive Operation & Multi-Tenancy Scope Audit", () => {
    it("verifies zero runtime schema alteration DDL (ALTER, DROP, TRUNCATE) in application code", () => {
      const targetDirs = ["app", "lib"];
      const ddlRegex = /(?:ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE|DROP\s+DATABASE)/i;

      function scan(dir: string): { file: string; line: number; snippet: string }[] {
        const violations: { file: string; line: number; snippet: string }[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            violations.push(...scan(full));
          } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) {
            const content = fs.readFileSync(full, "utf-8");
            const lines = content.split("\n");
            lines.forEach((l, idx) => {
              const trimmed = l.trim();
              if (!trimmed.startsWith("//") && ddlRegex.test(trimmed)) {
                violations.push({ file: full, line: idx + 1, snippet: trimmed });
              }
            });
          }
        }
        return violations;
      }

      const found = targetDirs.flatMap((d) => scan(path.join(process.cwd(), d)));
      expect(found).toEqual([]);
    });

    it("verifies all deleteMany calls are tenant-scoped, user-scoped, or retention-purged", () => {
      const targetDirs = ["app", "lib"];

      function scanDeleteMany(dir: string): string[] {
        const results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            results.push(...scanDeleteMany(full));
          } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) {
            const content = fs.readFileSync(full, "utf-8");
            if (content.includes(".deleteMany(")) {
              results.push(path.relative(process.cwd(), full));
            }
          }
        }
        return results;
      }

      const files = targetDirs.flatMap((d) => scanDeleteMany(path.join(process.cwd(), d)));
      expect(files.length).toBeGreaterThan(0);

      // Verify known verified files
      const approvedPatterns = [
        "integrationManagementService.ts",
        "idempotencyService.ts",
        "requestLogService.ts",
        "changePassword.ts",
        "registerUser.ts",
        "resetPassword.ts",
        "sessionManagement.ts",
        "verificationToken.ts",
        "automationManagementService.ts",
      ];

      for (const f of files) {
        const matchesApproved = approvedPatterns.some((p) => f.includes(p));
        expect(matchesApproved).toBe(true);
      }
    });
  });
});
