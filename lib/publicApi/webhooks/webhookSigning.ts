/**
 * Phase 1.18.18 — HMAC-SHA256 Webhook Signing & Verification
 *
 * Implements cryptographic signing of outbound webhook payloads and provides
 * constant-time receiver-side verification helpers with timestamp replay protection.
 */

import crypto from "node:crypto";

export interface WebhookSignatureResult {
    timestamp: number;
    signature: string;
    header: string;
}

export interface WebhookVerificationOptions {
    /**
     * Raw request body (string) or JSON object.
     */
    payload: string | Record<string, unknown>;

    /**
     * The value of the 'Aforden-Signature' HTTP request header (e.g. 't=1756641600,v1=a1b2c3...').
     */
    signatureHeader: string;

    /**
     * Webhook endpoint's signing secret (e.g. 'whsec_...').
     */
    secret: string;

    /**
     * Maximum allowed age of the timestamp in seconds (default: 300s / 5 minutes).
     */
    toleranceSeconds?: number;

    /**
     * Optional override for current time in seconds (for testing).
     */
    currentTimestampSeconds?: number;
}

export type WebhookVerificationFailureReason =
    | "MALFORMED_HEADER"
    | "INVALID_TIMESTAMP"
    | "TIMESTAMP_EXPIRED"
    | "SIGNATURE_MISMATCH";

export interface WebhookVerificationResult {
    isValid: boolean;
    timestamp?: number;
    reason?: WebhookVerificationFailureReason;
}

/**
 * Computes the HMAC-SHA256 signature for an outbound webhook payload and generates
 * the canonical 'Aforden-Signature' header.
 */
export function signWebhookPayload(
    secret: string,
    payload: string | Record<string, unknown>,
    timestampSeconds?: number,
): WebhookSignatureResult {
    const t = timestampSeconds ?? Math.floor(Date.now() / 1000);
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    const signedPayload = `${t}.${payloadStr}`;

    const signature = crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("hex");

    const header = `t=${t},v1=${signature}`;

    return {
        timestamp: t,
        signature,
        header,
    };
}

/**
 * Parses and verifies an incoming 'Aforden-Signature' header using constant-time comparison
 * and timestamp tolerance check.
 */
export function verifyWebhookSignature(
    options: WebhookVerificationOptions,
): WebhookVerificationResult {
    const {
        payload,
        signatureHeader,
        secret,
        toleranceSeconds = 300,
        currentTimestampSeconds,
    } = options;

    if (!signatureHeader || typeof signatureHeader !== "string") {
        return { isValid: false, reason: "MALFORMED_HEADER" };
    }

    // Parse header elements: t=12345678,v1=abcdef...
    const parts = signatureHeader.split(",");
    let timestampStr: string | null = null;
    let signatureHex: string | null = null;

    for (const part of parts) {
        const [key, ...rest] = part.trim().split("=");
        const value = rest.join("=");
        if (key === "t") {
            timestampStr = value;
        } else if (key === "v1") {
            signatureHex = value;
        }
    }

    if (!timestampStr || !signatureHex) {
        return { isValid: false, reason: "MALFORMED_HEADER" };
    }

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp) || timestamp <= 0) {
        return { isValid: false, reason: "INVALID_TIMESTAMP" };
    }

    const now = currentTimestampSeconds ?? Math.floor(Date.now() / 1000);

    // Replay protection: check timestamp tolerance
    if (toleranceSeconds > 0) {
        if (Math.abs(now - timestamp) > toleranceSeconds) {
            return {
                isValid: false,
                timestamp,
                reason: "TIMESTAMP_EXPIRED",
            };
        }
    }

    // Compute expected signature
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${payloadStr}`)
        .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const actualBuffer = Buffer.from(signatureHex, "utf8");

    if (expectedBuffer.length !== actualBuffer.length) {
        return { isValid: false, timestamp, reason: "SIGNATURE_MISMATCH" };
    }

    const isMatch = crypto.timingSafeEqual(expectedBuffer, actualBuffer);
    if (!isMatch) {
        return { isValid: false, timestamp, reason: "SIGNATURE_MISMATCH" };
    }

    return {
        isValid: true,
        timestamp,
    };
}
