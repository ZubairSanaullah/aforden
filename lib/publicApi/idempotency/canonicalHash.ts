import crypto from "node:crypto";

/**
 * Deterministic, key-sorted JSON serializer to guarantee identical SHA-256 hash
 * calculation regardless of client object key insertion order or formatting differences.
 */
export function canonicalJsonStringify(obj: unknown): string {
    if (obj === null || obj === undefined) {
        return "null";
    }

    if (typeof obj !== "object") {
        return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
        return "[" + obj.map((item) => canonicalJsonStringify(item)).join(",") + "]";
    }

    const record = obj as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const entries = sortedKeys.map(
        (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`,
    );

    return "{" + entries.join(",") + "}";
}

/**
 * Computes a SHA-256 hash of a canonicalized request payload.
 */
export function computePayloadHash(payload: unknown): string {
    const canonicalString = canonicalJsonStringify(payload ?? {});
    return crypto.createHash("sha256").update(canonicalString).digest("hex");
}

/**
 * Computes the unique SHA-256 hash for the four-part idempotency scope:
 * (workspaceId, apiKeyId, endpoint, idempotencyKey).
 */
export function computeScopedKeyHash(
    workspaceId: string,
    apiKeyId: string,
    endpoint: string,
    idempotencyKey: string,
): string {
    const rawScope = `${workspaceId}:${apiKeyId}:${endpoint}:${idempotencyKey}`;
    return crypto.createHash("sha256").update(rawScope).digest("hex");
}
