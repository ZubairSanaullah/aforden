import crypto from "crypto";

/**
 * Invitation rate limiting.
 *
 * In-memory MVP implementation — matches the pattern used by
 * verificationRateLimit.ts and passwordRecoveryRateLimit.ts.
 *
 * For multi-instance production deployments this should move to
 * a distributed store (Redis). That migration does not require
 * changing the public API of this module.
 */

interface RateLimitEntry {
    count: number;
    firstRequestAt: number;
}

interface RateLimitResult {
    allowed: boolean;
    retryAfterSeconds: number;
}

/** Minimum time between successive invitation emails to the same address. */
const INVITATION_EMAIL_COOLDOWN_MS = 60 * 1000; // 1 minute

/** Sliding window for workspace-level invitation creation. */
const WORKSPACE_INVITE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const WORKSPACE_INVITE_MAX = 20; // max invites per workspace per window

/** Sliding window for IP-level invitation creation. */
const IP_INVITE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const IP_INVITE_MAX = 10; // max invites per IP per window

/** Sliding window for token-based acceptance attempts. */
const ACCEPT_ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const ACCEPT_TOKEN_MAX = 10; // max attempts per token per window
const ACCEPT_IP_MAX = 20; // max acceptance attempts per IP per window

const emailCooldowns = new Map<string, number>();
const workspaceInviteRequests = new Map<string, RateLimitEntry>();
const ipInviteRequests = new Map<string, RateLimitEntry>();
const acceptTokenAttempts = new Map<string, RateLimitEntry>();
const acceptIpAttempts = new Map<string, RateLimitEntry>();

function hashIdentifier(value: string): string {
    return crypto
        .createHash("sha256")
        .update(value)
        .digest("hex");
}

function checkWindowLimit(
    store: Map<string, RateLimitEntry>,
    key: string,
    maxRequests: number,
    windowMs: number,
): RateLimitResult {
    const now = Date.now();
    const existing = store.get(key);

    if (!existing) {
        store.set(key, { count: 1, firstRequestAt: now });
        return { allowed: true, retryAfterSeconds: 0 };
    }

    const windowExpired =
        now - existing.firstRequestAt >= windowMs;

    if (windowExpired) {
        store.set(key, { count: 1, firstRequestAt: now });
        return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= maxRequests) {
        return {
            allowed: false,
            retryAfterSeconds: Math.ceil(
                (windowMs - (now - existing.firstRequestAt)) /
                1000,
            ),
        };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Rate-limits invitation creation.
 *
 * Checks:
 *   1. Per-email cooldown  — prevents email bombing a single address.
 *   2. Per-workspace limit — prevents a compromised workspace admin
 *      from spamming invitations.
 *   3. Per-IP limit        — prevents abuse from a single IP.
 */
export function checkInvitationCreateRateLimit(
    email: string,
    workspaceId: string,
    ipAddress: string,
): RateLimitResult {
    const now = Date.now();

    const emailKey = hashIdentifier(email.trim().toLowerCase());
    const lastEmail = emailCooldowns.get(emailKey);

    if (lastEmail && now - lastEmail < INVITATION_EMAIL_COOLDOWN_MS) {
        return {
            allowed: false,
            retryAfterSeconds: Math.ceil(
                (INVITATION_EMAIL_COOLDOWN_MS - (now - lastEmail)) /
                1000,
            ),
        };
    }

    const workspaceKey = hashIdentifier(workspaceId);
    const workspaceResult = checkWindowLimit(
        workspaceInviteRequests,
        workspaceKey,
        WORKSPACE_INVITE_MAX,
        WORKSPACE_INVITE_WINDOW_MS,
    );

    if (!workspaceResult.allowed) {
        return workspaceResult;
    }

    const ipKey = hashIdentifier(ipAddress);
    const ipResult = checkWindowLimit(
        ipInviteRequests,
        ipKey,
        IP_INVITE_MAX,
        IP_INVITE_WINDOW_MS,
    );

    if (!ipResult.allowed) {
        return ipResult;
    }

    emailCooldowns.set(emailKey, now);

    return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Rate-limits invitation acceptance attempts.
 *
 * Checks:
 *   1. Per-token attempt limit — prevents brute-force token guessing.
 *   2. Per-IP limit           — prevents distributed enumeration.
 */
export function checkInvitationAcceptRateLimit(
    rawToken: string,
    ipAddress: string,
): RateLimitResult {
    const tokenKey = hashIdentifier(rawToken);
    const tokenResult = checkWindowLimit(
        acceptTokenAttempts,
        tokenKey,
        ACCEPT_TOKEN_MAX,
        ACCEPT_ATTEMPT_WINDOW_MS,
    );

    if (!tokenResult.allowed) {
        return tokenResult;
    }

    const ipKey = hashIdentifier(ipAddress);
    return checkWindowLimit(
        acceptIpAttempts,
        ipKey,
        ACCEPT_IP_MAX,
        ACCEPT_ATTEMPT_WINDOW_MS,
    );
}
