import { describe, it, expect } from "vitest";
import {
  validateEnvironment,
  EnvironmentValidationError,
  baseEnvSchema,
  paddleEnvSchema,
  stripeEnvSchema,
  brevoEnvSchema,
  resendEnvSchema,
} from "@/lib/config/envValidation";

describe("Phase 1.22.3 — Startup Environment Validation", () => {
  const validBaseEnv: Record<string, string | undefined> = {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://postgres:password@localhost:5432/postgres",
    AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    BILLING_PROVIDER: "PADDLE",
    EMAIL_PROVIDER: "BREVO",
    CRON_SECRET: "cron-secret-123",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    AUTH_URL: "http://localhost:3000",
  };

  const validPaddleSecrets: Record<string, string | undefined> = {
    PADDLE_API_KEY: "paddlesecret_123",
    PADDLE_WEBHOOK_SECRET: "paddlenotification_123",
    PADDLE_ENVIRONMENT: "sandbox",
  };

  const validBrevoSecrets: Record<string, string | undefined> = {
    BREVO_API_KEY: "xkeysib-123",
    EMAIL_FROM: "notifications@aforden.com",
  };

  describe("Base Environment Validation", () => {
    it("accepts a valid baseline configuration", () => {
      const result = validateEnvironment(validBaseEnv, { requireProviderSecrets: false });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.data).toBeDefined();
    });

    it("rejects missing DATABASE_URL", () => {
      const { DATABASE_URL, ...rest } = validBaseEnv;
      const result = validateEnvironment(rest, { requireProviderSecrets: false });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
    });

    it("rejects non-PostgreSQL DATABASE_URL protocols", () => {
      const invalidEnv = {
        ...validBaseEnv,
        DATABASE_URL: "mysql://user:pass@localhost:3306/db",
      };
      const result = validateEnvironment(invalidEnv, { requireProviderSecrets: false });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("PostgreSQL"))).toBe(true);
    });

    it("accepts postgresql:// and postgres:// connection protocols", () => {
      const res1 = baseEnvSchema.safeParse({
        ...validBaseEnv,
        DATABASE_URL: "postgresql://localhost:5432/db",
      });
      const res2 = baseEnvSchema.safeParse({
        ...validBaseEnv,
        DATABASE_URL: "postgres://localhost:5432/db",
      });
      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
    });

    it("rejects missing AUTH_SECRET", () => {
      const { AUTH_SECRET, ...rest } = validBaseEnv;
      const result = validateEnvironment(rest, { requireProviderSecrets: false });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("AUTH_SECRET"))).toBe(true);
    });

    it("rejects invalid BILLING_PROVIDER enum", () => {
      const invalidEnv = { ...validBaseEnv, BILLING_PROVIDER: "BRAINTREE" as any };
      const result = validateEnvironment(invalidEnv, { requireProviderSecrets: false });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("BILLING_PROVIDER"))).toBe(true);
    });

    it("rejects invalid EMAIL_PROVIDER enum", () => {
      const invalidEnv = { ...validBaseEnv, EMAIL_PROVIDER: "SENDGRID" as any };
      const result = validateEnvironment(invalidEnv, { requireProviderSecrets: false });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("EMAIL_PROVIDER"))).toBe(true);
    });

    it("rejects missing CRON_SECRET", () => {
      const { CRON_SECRET, ...rest } = validBaseEnv;
      const result = validateEnvironment(rest, { requireProviderSecrets: false });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("CRON_SECRET"))).toBe(true);
    });

    it("rejects invalid URL for NEXT_PUBLIC_APP_URL", () => {
      const invalidEnv = { ...validBaseEnv, NEXT_PUBLIC_APP_URL: "not-a-valid-url" };
      const result = validateEnvironment(invalidEnv, { requireProviderSecrets: false });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_APP_URL"))).toBe(true);
    });
  });

  describe("Provider-Specific Secret Validation", () => {
    it("validates Paddle secrets when BILLING_PROVIDER is PADDLE", () => {
      const fullEnv = {
        ...validBaseEnv,
        ...validPaddleSecrets,
        ...validBrevoSecrets,
      };
      const result = validateEnvironment(fullEnv, { requireProviderSecrets: true });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("rejects missing PADDLE_API_KEY when BILLING_PROVIDER is PADDLE", () => {
      const missingKey = {
        ...validBaseEnv,
        PADDLE_WEBHOOK_SECRET: "paddlenotification_123",
        ...validBrevoSecrets,
      };
      const result = validateEnvironment(missingKey, { requireProviderSecrets: true });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("PADDLE_API_KEY"))).toBe(true);
    });

    it("rejects invalid PADDLE_ENVIRONMENT", () => {
      const invalidEnv = {
        ...validBaseEnv,
        ...validPaddleSecrets,
        PADDLE_ENVIRONMENT: "local-mock",
        ...validBrevoSecrets,
      };
      const result = validateEnvironment(invalidEnv, { requireProviderSecrets: true });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("PADDLE_ENVIRONMENT"))).toBe(true);
    });

    it("validates Stripe secrets when BILLING_PROVIDER is STRIPE", () => {
      const stripeEnv = {
        ...validBaseEnv,
        BILLING_PROVIDER: "STRIPE",
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: "whsec_123",
        ...validBrevoSecrets,
      };
      const result = validateEnvironment(stripeEnv, { requireProviderSecrets: true });
      expect(result.isValid).toBe(true);
    });

    it("rejects missing STRIPE_SECRET_KEY when BILLING_PROVIDER is STRIPE", () => {
      const stripeEnv = {
        ...validBaseEnv,
        BILLING_PROVIDER: "STRIPE",
        STRIPE_WEBHOOK_SECRET: "whsec_123",
        ...validBrevoSecrets,
      };
      const result = validateEnvironment(stripeEnv, { requireProviderSecrets: true });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("STRIPE_SECRET_KEY"))).toBe(true);
    });

    it("validates Brevo secrets when EMAIL_PROVIDER is BREVO", () => {
      const brevoEnv = {
        ...validBaseEnv,
        ...validPaddleSecrets,
        EMAIL_PROVIDER: "BREVO",
        BREVO_API_KEY: "xkeysib-123",
      };
      const result = validateEnvironment(brevoEnv, { requireProviderSecrets: true });
      expect(result.isValid).toBe(true);
    });

    it("validates Resend secrets when EMAIL_PROVIDER is RESEND", () => {
      const resendEnv = {
        ...validBaseEnv,
        ...validPaddleSecrets,
        EMAIL_PROVIDER: "RESEND",
        RESEND_API_KEY: "re_123",
      };
      const result = validateEnvironment(resendEnv, { requireProviderSecrets: true });
      expect(result.isValid).toBe(true);
    });

    it("rejects missing RESEND_API_KEY when EMAIL_PROVIDER is RESEND", () => {
      const resendEnv = {
        ...validBaseEnv,
        ...validPaddleSecrets,
        EMAIL_PROVIDER: "RESEND",
      };
      const result = validateEnvironment(resendEnv, { requireProviderSecrets: true });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("RESEND_API_KEY"))).toBe(true);
    });
  });

  describe("Fail-Fast Error Handling", () => {
    it("throws EnvironmentValidationError when throwOnError is true and validation fails", () => {
      expect(() => {
        validateEnvironment({}, { throwOnError: true, requireProviderSecrets: false });
      }).toThrow(EnvironmentValidationError);
    });

    it("formats error messages clearly in EnvironmentValidationError", () => {
      try {
        validateEnvironment({}, { throwOnError: true, requireProviderSecrets: false });
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(EnvironmentValidationError);
        expect(err.message).toContain("Environment validation failed:");
        expect(err.message).toContain("DATABASE_URL");
        expect(err.message).toContain("AUTH_SECRET");
        expect(err.errors.length).toBeGreaterThanOrEqual(3);
      }
    });

    it("returns result without throwing when throwOnError is false", () => {
      const result = validateEnvironment({}, { throwOnError: false, requireProviderSecrets: false });
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
