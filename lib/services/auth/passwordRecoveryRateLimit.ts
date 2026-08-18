import crypto from "crypto";

interface RateLimitEntry {
    count: number;
    firstRequestAt: number;
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

const RESET_ATTEMPT_WINDOW_MS =
    15 * 60 * 1000;

const RESET_MAX_ATTEMPTS = 10;

const emailCooldowns =
    new Map<string, number>();

const ipRequests =
    new Map<string, RateLimitEntry>();

const resetAttempts =
    new Map<string, RateLimitEntry>();

function hashIdentifier(
    value: string
): string {
    return crypto
        .createHash("sha256")
        .update(value)
        .digest("hex");
}

function checkWindowLimit(
    store: Map<string, RateLimitEntry>,
    key: string,
    maxRequests: number,
    windowMs: number
): RateLimitResult {
    const now = Date.now();

    const existing =
        store.get(key);

    if (!existing) {
        store.set(key, {
            count: 1,
            firstRequestAt: now,
        });

        return {
            allowed: true,
            retryAfterSeconds: 0,
        };
    }

    if (
        now -
        existing.firstRequestAt >=
        windowMs
    ) {
        store.set(key, {
            count: 1,
            firstRequestAt: now,
        });

        return {
            allowed: true,
            retryAfterSeconds: 0,
        };
    }

    if (
        existing.count >=
        maxRequests
    ) {
        return {
            allowed: false,
            retryAfterSeconds:
                Math.ceil(
                    (windowMs -
                        (now -
                            existing.firstRequestAt)) /
                    1000
                ),
        };
    }

    existing.count += 1;

    return {
        allowed: true,
        retryAfterSeconds: 0,
    };
}

export function checkForgotPasswordRateLimit(
    email: string,
    ipAddress: string
): RateLimitResult {
    const normalizedEmail =
        email.trim().toLowerCase();

    const emailKey =
        hashIdentifier(
            normalizedEmail
        );

    const ipKey =
        hashIdentifier(ipAddress);

    const now = Date.now();

    const lastRequest =
        emailCooldowns.get(
            emailKey
        );

    if (
        lastRequest &&
        now - lastRequest <
        EMAIL_COOLDOWN_MS
    ) {
        return {
            allowed: false,
            retryAfterSeconds:
                Math.ceil(
                    (EMAIL_COOLDOWN_MS -
                        (now -
                            lastRequest)) /
                    1000
                ),
        };
    }

    const ipResult =
        checkWindowLimit(
            ipRequests,
            ipKey,
            IP_MAX_REQUESTS,
            IP_WINDOW_MS
        );

    if (!ipResult.allowed) {
        return ipResult;
    }

    emailCooldowns.set(
        emailKey,
        now
    );

    return {
        allowed: true,
        retryAfterSeconds: 0,
    };
}

export function checkResetPasswordRateLimit(
    token: string,
    ipAddress: string
): RateLimitResult {
    const tokenKey =
        hashIdentifier(
            token
        );

    const ipKey =
        hashIdentifier(ipAddress);

    const tokenResult =
        checkWindowLimit(
            resetAttempts,
            tokenKey,
            RESET_MAX_ATTEMPTS,
            RESET_ATTEMPT_WINDOW_MS
        );

    if (!tokenResult.allowed) {
        return tokenResult;
    }

    return checkWindowLimit(
        ipRequests,
        ipKey,
        IP_MAX_REQUESTS,
        IP_WINDOW_MS
    );
}