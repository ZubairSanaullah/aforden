/**
 * Next.js Server Lifecycle Instrumentation Hook
 * Executes at startup before the application begins receiving incoming traffic.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironment } = await import("@/lib/config/envValidation");

    const isBuildPhase =
      process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.npm_lifecycle_event === "build";
    const skipValidation = process.env.SKIP_ENV_VALIDATION === "1";
    const isProduction = process.env.NODE_ENV === "production";

    const result = validateEnvironment(process.env, {
      throwOnError: isProduction && !isBuildPhase && !skipValidation,
      requireProviderSecrets: isProduction && !isBuildPhase,
    });

    if (!result.isValid) {
      if (isProduction && !isBuildPhase && !skipValidation) {
        // Will have thrown EnvironmentValidationError above
      } else {
        console.warn(
          `[EnvValidation] Startup environment warnings detected (${result.errors.length}):\n  - ${result.errors.join("\n  - ")}`
        );
      }
    }
  }
}
