/**
 * Rate Limiting Types & Constants for Aforden's Public API.
 * Phase 1.18.13 — Rate Limiting & Abuse Protection
 */

export const RATE_LIMIT_HEADERS = {
    LIMIT: "X-RateLimit-Limit",
    REMAINING: "X-RateLimit-Remaining",
    RESET: "X-RateLimit-Reset",
    RETRY_AFTER: "Retry-After",
} as const;

export type RateLimitTier = "KEY" | "WORKSPACE" | "IP";

export interface RateLimitTierConfig {
    limit: number;
    windowMs: number;
}

export interface RateLimitResult {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetEpochSeconds: number;
    retryAfterSeconds: number;
    tier?: RateLimitTier;
}

export interface RateLimitStore {
    /**
     * Records a hit against the sliding window for the given key and checks quota.
     */
    incrementAndCheck(
        key: string,
        limit: number,
        windowMs: number,
        now?: number,
    ): Promise<RateLimitResult>;

    /**
     * Resets/clears the rate limit window for a specific key (useful in tests and manual resets).
     */
    reset(key: string): Promise<void>;

    /**
     * Clears all entries in the store (useful in tests).
     */
    clear(): Promise<void>;
}

export interface PublicApiRateLimitConfig {
    /**
     * Default per-API-key request limit per window (default 120 req/min).
     */
    defaultKeyLimit: number;

    /**
     * Default aggregate per-workspace request limit per window (default 600 req/min).
     */
    defaultWorkspaceLimit: number;

    /**
     * Default unauthenticated failed-auth request limit per IP per window (default 60 req/min).
     */
    defaultUnauthenticatedIpLimit: number;

    /**
     * Sliding window duration in milliseconds (default 60,000 ms = 1 minute).
     */
    windowMs: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: PublicApiRateLimitConfig = {
    defaultKeyLimit: 120,
    defaultWorkspaceLimit: 600,
    defaultUnauthenticatedIpLimit: 60,
    windowMs: 60 * 1000,
};
