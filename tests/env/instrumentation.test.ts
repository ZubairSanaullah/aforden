import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Phase 1.22.3 — Server Lifecycle Instrumentation (instrumentation.ts)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("skips execution when NEXT_RUNTIME is not nodejs", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("executes successfully in nodejs runtime with valid environment", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/postgres";
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.BILLING_PROVIDER = "PADDLE";
    process.env.EMAIL_PROVIDER = "BREVO";

    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("warns rather than throwing during build phase (phase-production-build)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NEXT_RUNTIME = "nodejs";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXT_PHASE = "phase-production-build";
    delete process.env.DATABASE_URL; // missing

    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns rather than throwing when SKIP_ENV_VALIDATION is 1", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NEXT_RUNTIME = "nodejs";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.SKIP_ENV_VALIDATION = "1";
    delete process.env.DATABASE_URL;

    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("throws EnvironmentValidationError in production runtime when invalid", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    delete process.env.SKIP_ENV_VALIDATION;
    delete process.env.DATABASE_URL;

    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow("Environment validation failed:");
  });
});
