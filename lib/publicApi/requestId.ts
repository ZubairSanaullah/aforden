export const REQUEST_ID_HEADER_NAME = "X-Request-Id";

// Base32 Crockford alphabet (clean, unambiguous characters)
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Validates whether an incoming request ID string conforms to safe format constraints.
 * Allowed: 1-64 alphanumeric characters, dashes, and underscores.
 * Disallowed: Control characters, whitespace, newlines, quotes, HTML, path traversal.
 */
export function isValidRequestId(id: unknown): id is string {
    if (typeof id !== "string") {
        return false;
    }
    const trimmed = id.trim();
    if (trimmed.length < 1 || trimmed.length > 64) {
        return false;
    }
    return /^[a-zA-Z0-9_-]{1,64}$/.test(trimmed);
}

/**
 * Generates a high-entropy, timestamp-ordered request ID using Web Crypto API.
 * Compatible with Edge Runtime, Browser, and Node.js without Node built-in dependencies.
 * Format: req_<10_char_time><16_char_random> (e.g. req_01HPX7K9V4Z8Y6M2E3W1N0QRST)
 */
export function generateRequestId(): string {
    const time = Date.now();
    let timeStr = "";
    let t = time;
    for (let i = 0; i < 10; i++) {
        timeStr = CROCKFORD_ALPHABET[t % 32] + timeStr;
        t = Math.floor(t / 32);
    }

    const randomBytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(randomBytes);

    let randStr = "";
    for (let i = 0; i < 16; i++) {
        randStr += CROCKFORD_ALPHABET[randomBytes[i] % 32];
    }

    return `req_${timeStr}${randStr}`;
}

/**
 * Resolves a request ID from an incoming request header, or generates a new one
 * if missing or invalid.
 */
export function resolveRequestId(incomingHeaderValue?: string | null): {
    requestId: string;
    isGenerated: boolean;
} {
    if (incomingHeaderValue && isValidRequestId(incomingHeaderValue)) {
        return {
            requestId: incomingHeaderValue.trim(),
            isGenerated: false,
        };
    }

    return {
        requestId: generateRequestId(),
        isGenerated: true,
    };
}
