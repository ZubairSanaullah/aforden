import { z } from "zod";

/**
 * Custom error thrown when environment variable validation fails at startup.
 */
export class EnvironmentValidationError extends Error {
  public readonly errors: string[];

  constructor(errors: string[]) {
    super(`Environment validation failed:\n  - ${errors.join("\n  - ")}`);
    this.name = "EnvironmentValidationError";
    this.errors = errors;
  }
}

/**
 * Core base schema for platform operations.
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (val) => val.startsWith("postgresql://") || val.startsWith("postgres://"),
      { message: "DATABASE_URL must be a valid PostgreSQL connection string (postgresql://...)" }
    ),
  AUTH_SECRET: z
    .string()
    .min(1, "AUTH_SECRET is required"),
  BILLING_PROVIDER: z
    .enum(["PADDLE", "STRIPE", "MOCK"])
    .default("PADDLE"),
  EMAIL_PROVIDER: z
    .enum(["BREVO", "RESEND"])
    .default("BREVO"),
  CRON_SECRET: z
    .string()
    .min(1, "CRON_SECRET is required"),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url("NEXT_PUBLIC_APP_URL must be a valid URL")
    .optional()
    .or(z.literal("")),
  AUTH_URL: z
    .string()
    .url("AUTH_URL must be a valid URL")
    .optional()
    .or(z.literal("")),
  AUTH_TRUST_HOST: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .or(z.literal("")),
  INTEGRATION_KEY_ENCRYPTION_SECRET: z
    .string()
    .optional(),
  ENCRYPTION_MASTER_KEY: z
    .string()
    .optional(),
});

/**
 * Provider-specific validation rules based on active configuration.
 */
export const paddleEnvSchema = z.object({
  PADDLE_API_KEY: z
    .string()
    .min(1, "PADDLE_API_KEY is required when BILLING_PROVIDER is PADDLE"),
  PADDLE_WEBHOOK_SECRET: z
    .string()
    .min(1, "PADDLE_WEBHOOK_SECRET is required when BILLING_PROVIDER is PADDLE"),
  PADDLE_ENVIRONMENT: z
    .enum(["sandbox", "production"])
    .default("sandbox"),
});

export const stripeEnvSchema = z.object({
  STRIPE_SECRET_KEY: z
    .string()
    .min(1, "STRIPE_SECRET_KEY is required when BILLING_PROVIDER is STRIPE"),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .min(1, "STRIPE_WEBHOOK_SECRET is required when BILLING_PROVIDER is STRIPE"),
});

export const brevoEnvSchema = z.object({
  BREVO_API_KEY: z
    .string()
    .min(1, "BREVO_API_KEY is required when EMAIL_PROVIDER is BREVO"),
  EMAIL_FROM: z
    .string()
    .min(1, "EMAIL_FROM cannot be empty")
    .optional(),
});

export const resendEnvSchema = z.object({
  RESEND_API_KEY: z
    .string()
    .min(1, "RESEND_API_KEY is required when EMAIL_PROVIDER is RESEND"),
  EMAIL_FROM: z
    .string()
    .min(1, "EMAIL_FROM cannot be empty")
    .optional(),
});

export interface ValidationOptions {
  /**
   * Whether to throw EnvironmentValidationError when validation fails.
   * Default: false (returns structured result).
   */
  throwOnError?: boolean;
  /**
   * Whether to strictly validate provider-specific secrets.
   * Default: true in production, false in development/test unless explicitly passed.
   */
  requireProviderSecrets?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  data?: Record<string, unknown>;
}

/**
 * Validate environment variables against platform constraints.
 */
export function validateEnvironment(
  rawEnv: Record<string, string | undefined> = process.env,
  options: ValidationOptions = {}
): ValidationResult {
  const errors: string[] = [];
  const baseResult = baseEnvSchema.safeParse(rawEnv);

  if (!baseResult.success) {
    for (const issue of baseResult.error.issues) {
      const field = issue.path.join(".") || "environment";
      errors.push(`${field}: ${issue.message}`);
    }
  }

  const parsedBase = baseResult.success ? baseResult.data : null;
  const isProd = (parsedBase?.NODE_ENV || rawEnv.NODE_ENV) === "production";

  // Enforce AUTH_SECRET minimum length (>= 32 characters) in production
  const authSecret = parsedBase?.AUTH_SECRET || rawEnv.AUTH_SECRET;
  if (isProd && authSecret && authSecret.length < 32) {
    errors.push("AUTH_SECRET: AUTH_SECRET must be at least 32 characters in production");
  }

  // Enforce INTEGRATION_KEY_ENCRYPTION_SECRET / ENCRYPTION_MASTER_KEY in production
  if (isProd) {
    const encryptionSecret =
      rawEnv.INTEGRATION_KEY_ENCRYPTION_SECRET || rawEnv.ENCRYPTION_MASTER_KEY;
    if (!encryptionSecret) {
      errors.push(
        "INTEGRATION_KEY_ENCRYPTION_SECRET: INTEGRATION_KEY_ENCRYPTION_SECRET or ENCRYPTION_MASTER_KEY is required in production",
      );
    } else if (encryptionSecret.length < 32) {
      errors.push(
        "INTEGRATION_KEY_ENCRYPTION_SECRET: INTEGRATION_KEY_ENCRYPTION_SECRET must be at least 32 characters in production",
      );
    }
  }

  const requireSecrets =
    options.requireProviderSecrets !== undefined
      ? options.requireProviderSecrets
      : isProd;

  if (requireSecrets) {
    const billingProvider = parsedBase?.BILLING_PROVIDER || rawEnv.BILLING_PROVIDER || "PADDLE";
    if (billingProvider === "PADDLE") {
      const paddleResult = paddleEnvSchema.safeParse(rawEnv);
      if (!paddleResult.success) {
        for (const issue of paddleResult.error.issues) {
          errors.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      }
    } else if (billingProvider === "STRIPE") {
      const stripeResult = stripeEnvSchema.safeParse(rawEnv);
      if (!stripeResult.success) {
        for (const issue of stripeResult.error.issues) {
          errors.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      }
    }

    const emailProvider = parsedBase?.EMAIL_PROVIDER || rawEnv.EMAIL_PROVIDER || "BREVO";
    if (emailProvider === "BREVO") {
      const brevoResult = brevoEnvSchema.safeParse(rawEnv);
      if (!brevoResult.success) {
        for (const issue of brevoResult.error.issues) {
          errors.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      }
    } else if (emailProvider === "RESEND") {
      const resendResult = resendEnvSchema.safeParse(rawEnv);
      if (!resendResult.success) {
        for (const issue of resendResult.error.issues) {
          errors.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      }
    }
  }

  const isValid = errors.length === 0;

  if (!isValid && options.throwOnError) {
    throw new EnvironmentValidationError(errors);
  }

  return {
    isValid,
    errors,
    data: isValid && baseResult.success ? baseResult.data : undefined,
  };
}
