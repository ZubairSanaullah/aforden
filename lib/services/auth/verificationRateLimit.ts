import crypto from "crypto";

interface RateLimitEntry {
    count: number;
    firstRequestAt: number;
    lastRequestAt: number;
}

interface RateLimitResult {
    allowed: boolean;
    retryAfterSeconds: number;
}

const EMAIL_COOLDOWN_MS =
    60 * 1000;

const IP_WINDOW_MS =
    15 * 60 * 1000;

const IP_MAX_REQUESTS = 10;

/**
 * In-memory rate-limit stores.
 *
 * This is intentionally an MVP implementation.
 * For multi-instance production deployments,
 * this should eventually move to Redis or another
 * shared distributed store.
 */
const emailCooldowns =
    new Map<string, number>();

const ipRequests =
    new Map<string, RateLimitEntry>();

function normalizeEmail(
    email: string
): string {
    return email
        .trim()
        .toLowerCase();
}

function hashIdentifier(
    value: string
): string {
    return crypto
        .createHash("sha256")
        .update(value)
        .digest("hex");
}

export function checkVerificationEmailRateLimit(
    email: string,
    ipAddress: string
): RateLimitResult {
    const normalizedEmail =
        normalizeEmail(email);

    const now = Date.now();

    /**
     * Email cooldown
     */
    const emailKey =
        hashIdentifier(
            normalizedEmail
        );

    const lastEmailRequest =
        emailCooldowns.get(
            emailKey
        );

    if (
        lastEmailRequest &&
        now - lastEmailRequest <
        EMAIL_COOLDOWN_MS
    ) {
        const retryAfterSeconds =
            Math.ceil(
                (EMAIL_COOLDOWN_MS -
                    (now -
                        lastEmailRequest)) /
                1000
            );

        return {
            allowed: false,
            retryAfterSeconds,
        };
    }

    /**
     * IP-based rate limit
     */
    const ipKey =
        hashIdentifier(
            ipAddress
        );

    const existing =
        ipRequests.get(ipKey);

    if (!existing) {
        ipRequests.set(ipKey, {
            count: 1,
            firstRequestAt: now,
            lastRequestAt: now,
        });

        emailCooldowns.set(
            emailKey,
            now
        );

        return {
            allowed: true,
            retryAfterSeconds: 0,
        };
    }

    const windowExpired =
        now -
        existing.firstRequestAt >=
        IP_WINDOW_MS;

    if (windowExpired) {
        ipRequests.set(ipKey, {
            count: 1,
            firstRequestAt: now,
            lastRequestAt: now,
        });

        emailCooldowns.set(
            emailKey,
            now
        );

        return {
            allowed: true,
            retryAfterSeconds: 0,
        };
    }

    if (
        existing.count >=
        IP_MAX_REQUESTS
    ) {
        const retryAfterSeconds =
            Math.ceil(
                (IP_WINDOW_MS -
                    (now -
                        existing.firstRequestAt)) /
                1000
            );

        return {
            allowed: false,
            retryAfterSeconds,
        };
    }

    existing.count += 1;
    existing.lastRequestAt = now;

    emailCooldowns.set(
        emailKey,
        now
    );

    return {
        allowed: true,
        retryAfterSeconds: 0,
    };
}