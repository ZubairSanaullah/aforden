import crypto from "crypto";
import {
    RateLimitResult,
    RateLimitStore,
    RATE_LIMIT_HEADERS,
    DEFAULT_RATE_LIMIT_CONFIG,
    PublicApiRateLimitConfig,
} from "./rateLimit.types";
import { defaultMemoryRateLimitStore, MemoryRateLimitStore } from "./memoryRateLimitStore";
import { prisma } from "@/lib/prisma";
import { PlanTier } from "@/generated/prisma/enums";
import { NON_TERMINAL_SUBSCRIPTION_STATUSES } from "@/lib/services/billing/subscriptionStateMachine";

let activeRateLimitStore: RateLimitStore = defaultMemoryRateLimitStore;
let activeRateLimitConfig: PublicApiRateLimitConfig = {
    ...DEFAULT_RATE_LIMIT_CONFIG,
};

/**
 * Subscription Tier Quotas for Workspace Aggregate Rate Limiting.
 * Specified in Phase 1.18.1 Architecture §13.1 (Starter: 300, Professional/Growth: 1200, Enterprise: 6000).
 */
export const SUBSCRIPTION_TIER_WORKSPACE_LIMITS: Record<string, number> = {
    [PlanTier.STARTER]: 300,
    [PlanTier.GROWTH]: 1200,
    [PlanTier.ENTERPRISE]: 6000,
    [PlanTier.CUSTOM]: 6000,
    [PlanTier.COMMUNITY_FREE]: 300,
};

export const DEFAULT_WORKSPACE_TIER_LIMIT = 300;

// In-memory cache for resolved workspace tier limit (TTL 60s) to avoid extra DB queries on every request
const workspaceTierLimitCache = new Map<
    string,
    { limit: number; expiresAt: number }
>();

export function clearWorkspaceTierLimitCache(): void {
    workspaceTierLimitCache.clear();
}

/**
 * Resolves the workspace's aggregate rate limit based on its active SaaS subscription plan tier.
 */
export async function resolveWorkspaceTierLimit(
    workspaceId: string,
): Promise<number> {
    const now = Date.now();
    const cached = workspaceTierLimitCache.get(workspaceId);
    if (cached && cached.expiresAt > now) {
        return cached.limit;
    }

    try {
        const sub = await prisma.subscription.findFirst({
            where: {
                workspaceId,
                status: { in: [...NON_TERMINAL_SUBSCRIPTION_STATUSES] },
            },
            include: {
                plan: true,
            },
            orderBy: { createdAt: "desc" },
        });

        const tier = sub?.plan?.tier;
        const limit =
            tier && SUBSCRIPTION_TIER_WORKSPACE_LIMITS[tier]
                ? SUBSCRIPTION_TIER_WORKSPACE_LIMITS[tier]
                : DEFAULT_WORKSPACE_TIER_LIMIT;

        workspaceTierLimitCache.set(workspaceId, {
            limit,
            expiresAt: now + 60 * 1000,
        });

        return limit;
    } catch {
        return DEFAULT_WORKSPACE_TIER_LIMIT;
    }
}

/**
 * Configure or override the active rate limit store (e.g. for testing or distributed Redis setup).
 */
export function setRateLimitStore(store: RateLimitStore): void {
    activeRateLimitStore = store;
}

export function getRateLimitStore(): RateLimitStore {
    return activeRateLimitStore;
}

export function setRateLimitConfig(
    config: Partial<PublicApiRateLimitConfig>,
): void {
    activeRateLimitConfig = {
        ...activeRateLimitConfig,
        ...config,
    };
}

export function getRateLimitConfig(): PublicApiRateLimitConfig {
    return activeRateLimitConfig;
}

export function resetRateLimitConfig(): void {
    activeRateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG };
    clearWorkspaceTierLimitCache();
}

/**
 * Extract client IP safely from standard proxy headers.
 */
export function extractClientIp(request: Request): string {
    const xForwardedFor = request.headers.get("x-forwarded-for");
    if (xForwardedFor) {
        const first = xForwardedFor.split(",")[0]?.trim();
        if (first) return first;
    }

    const xRealIp = request.headers.get("x-real-ip");
    if (xRealIp?.trim()) {
        return xRealIp.trim();
    }

    const cfConnectingIp = request.headers.get("cf-connecting-ip");
    if (cfConnectingIp?.trim()) {
        return cfConnectingIp.trim();
    }

    return "127.0.0.1";
}

/**
 * Hashes an arbitrary rate-limit key to a fixed-length hex string.
 * Named hashRateLimitKey rather than hashIp because it is now used for
 * composite keys (e.g. workspaceId+sessionToken) in addition to raw IPs.
 */
function hashRateLimitKey(key: string): string {
    return crypto.createHash("sha256").update(key).digest("hex").substring(0, 32);
}

export interface CheckAuthenticatedRateLimitOptions {
    keyLimit?: number;
    workspaceLimit?: number;
    windowMs?: number;
    store?: RateLimitStore;
    now?: number;
}

/**
 * Enforces dual-tiered rate limiting for authenticated Public API requests.
 * Tier 1: Per-API-Key quota (e.g. 120 req/min).
 * Tier 2: Per-Workspace aggregate quota (Starter: 300, Growth: 1200, Enterprise: 6000 req/min).
 */
export async function checkAuthenticatedRateLimit(
    workspaceId: string,
    apiKeyId: string,
    options?: CheckAuthenticatedRateLimitOptions,
): Promise<RateLimitResult> {
    const store = options?.store ?? activeRateLimitStore;
    const windowMs = options?.windowMs ?? activeRateLimitConfig.windowMs;
    const keyLimit =
        options?.keyLimit ?? activeRateLimitConfig.defaultKeyLimit;

    // Resolve workspace limit: explicit option > custom config override > subscription tier lookup
    let workspaceLimit: number;
    if (options?.workspaceLimit !== undefined) {
        workspaceLimit = options.workspaceLimit;
    } else if (
        activeRateLimitConfig.defaultWorkspaceLimit !==
        DEFAULT_RATE_LIMIT_CONFIG.defaultWorkspaceLimit
    ) {
        workspaceLimit = activeRateLimitConfig.defaultWorkspaceLimit;
    } else {
        workspaceLimit = await resolveWorkspaceTierLimit(workspaceId);
    }

    const now = options?.now ?? Date.now();

    const keyBucket = `rl:key:${apiKeyId}`;
    const workspaceBucket = `rl:ws:${workspaceId}`;

    // Evaluate both tiers concurrently
    const [keyResult, workspaceResult] = await Promise.all([
        store.incrementAndCheck(keyBucket, keyLimit, windowMs, now),
        store.incrementAndCheck(workspaceBucket, workspaceLimit, windowMs, now),
    ]);

    // Check if either tier was exceeded
    if (!keyResult.allowed) {
        return {
            ...keyResult,
            tier: "KEY",
        };
    }

    if (!workspaceResult.allowed) {
        return {
            ...workspaceResult,
            tier: "WORKSPACE",
        };
    }

    // If both allowed, reflect the most restrictive tier in the response headers
    if (keyResult.remaining <= workspaceResult.remaining) {
        return {
            ...keyResult,
            tier: "KEY",
        };
    } else {
        return {
            ...workspaceResult,
            tier: "WORKSPACE",
        };
    }
}

export interface CheckUnauthenticatedRateLimitOptions {
    ipLimit?: number;
    windowMs?: number;
    store?: RateLimitStore;
    now?: number;
}

export interface CheckSlidingWindowOptions {
    limit: number;
    windowMs?: number;
    store?: MemoryRateLimitStore;
    now?: number;
}

/**
 * General-purpose synchronous sliding-window rate-limit check.
 *
 * The caller is responsible for composing a semantically meaningful `bucketKey`
 * (e.g. `rl:rest:ws:{workspaceId}:{hash}` for workspace actor routes,
 *  or `rl:unauth:ip:{hash}` for unauthenticated IP routes).
 * Using an explicit bucket key here avoids the parameter-name mismatch
 * that previously existed when composite workspace+actor strings were passed
 * into a parameter named `clientIp`.
 *
 * Falls back to "allow" if the active store does not implement
 * `incrementAndCheckSync` (e.g. a future async-only Redis store).
 */
export function checkSlidingWindowSync(
    bucketKey: string,
    options: CheckSlidingWindowOptions,
): RateLimitResult {
    const store = options.store ?? (activeRateLimitStore as MemoryRateLimitStore);
    const windowMs = options.windowMs ?? activeRateLimitConfig.windowMs;
    const { limit } = options;
    const now = options.now ?? Date.now();

    if (typeof store.incrementAndCheckSync !== "function") {
        // Graceful fallback: allow the request, headers will reflect limit
        return {
            allowed: true,
            limit,
            remaining: limit - 1,
            resetEpochSeconds: Math.ceil((now + windowMs) / 1000),
            retryAfterSeconds: 0,
        };
    }

    return store.incrementAndCheckSync(bucketKey, limit, windowMs, now);
}

/**
 * Synchronous rate-limit check for unauthenticated / pre-auth requests, keyed by IP.
 * Bucket prefix: `rl:unauth:ip:` — reflects that this counter tracks IP-level
 * unauthenticated traffic (login attempts, password-reset, etc.).
 *
 * For authenticated workspace routes, use checkSlidingWindowSync directly with
 * a `rl:rest:` prefixed bucket key to avoid misleading naming.
 */
export function checkUnauthenticatedRateLimitSync(
    clientIp: string,
    options?: CheckUnauthenticatedRateLimitOptions,
): RateLimitResult {
    const limit =
        options?.ipLimit ?? activeRateLimitConfig.defaultUnauthenticatedIpLimit;
    const windowMs = options?.windowMs ?? activeRateLimitConfig.windowMs;
    const store = options?.store as MemoryRateLimitStore | undefined;
    const now = options?.now;

    const bucket = `rl:unauth:ip:${hashRateLimitKey(clientIp)}`;
    return checkSlidingWindowSync(bucket, { limit, windowMs, store, now });
}

/**
 * Enforces abuse/brute-force rate limiting for unauthenticated / failed-auth requests by IP.
 */
export async function checkUnauthenticatedRateLimit(
    clientIp: string,
    options?: CheckUnauthenticatedRateLimitOptions,
): Promise<RateLimitResult> {
    return checkUnauthenticatedRateLimitSync(clientIp, options);
}

/**
 * Attaches standard RFC X-RateLimit-* and Retry-After headers to an outgoing Headers collection.
 */
export function attachRateLimitHeaders(
    headers: Headers,
    rateLimitResult: RateLimitResult,
): void {
    headers.set(RATE_LIMIT_HEADERS.LIMIT, rateLimitResult.limit.toString());
    headers.set(
        RATE_LIMIT_HEADERS.REMAINING,
        Math.max(0, rateLimitResult.remaining).toString(),
    );
    headers.set(
        RATE_LIMIT_HEADERS.RESET,
        rateLimitResult.resetEpochSeconds.toString(),
    );

    if (!rateLimitResult.allowed && rateLimitResult.retryAfterSeconds > 0) {
        headers.set(
            RATE_LIMIT_HEADERS.RETRY_AFTER,
            rateLimitResult.retryAfterSeconds.toString(),
        );
    }
}
