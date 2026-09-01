import crypto from "crypto";
import bcrypt from "bcrypt";

/**
 * Precomputed valid cost-10 bcrypt hash used for dummy comparison.
 * Generated from a high-entropy random salt and secret, ensuring constant CPU work
 * when comparing against non-existent users or missing password hashes.
 */
export const DUMMY_BCRYPT_HASH =
    "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/**
 * Compares two strings in constant time to prevent timing side-channel attacks (Phase 1.19.18).
 * 
 * Cryptographic Invariant:
 * Standard `crypto.timingSafeEqual` throws a TypeError if input buffers have differing lengths,
 * which tempts developers into early `if (a.length !== b.length) return false;` guards that
 * leak length information via timing side-channels.
 * 
 * To eliminate this leak, both strings are hashed with SHA-256 first. The resulting 32-byte
 * digests are compared using `crypto.timingSafeEqual`, guaranteeing uniform execution time
 * regardless of the length or contents of the candidate strings.
 */
export function timingSafeEqualStrings(
    a: string | null | undefined,
    b: string | null | undefined
): boolean {
    if (typeof a !== "string" || typeof b !== "string") {
        // Run dummy hash to equalize branch latency
        const dummyA = crypto.createHash("sha256").update("").digest();
        const dummyB = crypto.createHash("sha256").update(" ").digest();
        crypto.timingSafeEqual(dummyA, dummyB);
        return false;
    }

    const hashA = crypto.createHash("sha256").update(a, "utf8").digest();
    const hashB = crypto.createHash("sha256").update(b, "utf8").digest();

    const digestsMatch = crypto.timingSafeEqual(hashA, hashB);
    return digestsMatch && a.length === b.length;
}

/**
 * Compares two buffers in constant time using SHA-256 digest normalization.
 */
export function timingSafeEqualBuffers(
    a: Buffer | null | undefined,
    b: Buffer | null | undefined
): boolean {
    if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
        const dummyA = crypto.createHash("sha256").update("").digest();
        const dummyB = crypto.createHash("sha256").update(" ").digest();
        crypto.timingSafeEqual(dummyA, dummyB);
        return false;
    }

    const hashA = crypto.createHash("sha256").update(a).digest();
    const hashB = crypto.createHash("sha256").update(b).digest();

    const digestsMatch = crypto.timingSafeEqual(hashA, hashB);
    return digestsMatch && a.length === b.length;
}

/**
 * Hashes a candidate string using the specified algorithm and compares it to an expected hash
 * in constant time.
 */
export function constantTimeHashCompare(
    candidate: string,
    expectedHash: string,
    algorithm = "sha256"
): boolean {
    if (typeof candidate !== "string" || typeof expectedHash !== "string") {
        return timingSafeEqualStrings("", " ");
    }

    const candidateHash = crypto.createHash(algorithm).update(candidate, "utf8").digest("hex");
    return timingSafeEqualStrings(candidateHash, expectedHash);
}

/**
 * Compares a password against a bcrypt hash in constant time (Phase 1.19.18).
 * 
 * If the provided hash is null, undefined, or malformed, this function still executes
 * a full bcrypt comparison against `DUMMY_BCRYPT_HASH`, preventing identity enumeration
 * attacks where attackers measure response latencies (~150ms vs ~2ms) to discern whether
 * an account exists and has a password configured.
 */
export async function constantTimeBcryptCompare(
    password: string,
    hash: string | null | undefined
): Promise<boolean> {
    const isValidHashFormat =
        typeof hash === "string" &&
        hash.startsWith("$2") &&
        hash.length >= 59;

    const hashToCompare = isValidHashFormat ? hash! : DUMMY_BCRYPT_HASH;

    try {
        const matches = await bcrypt.compare(password, hashToCompare);
        return isValidHashFormat && matches;
    } catch {
        // In the rare event of a native bcrypt error, run dummy compare
        try {
            await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
        } catch {}
        return false;
    }
}
