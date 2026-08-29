import {
    hashApiKey,
    resolveActiveApiKeyByKeyHash,
    touchApiKeyLastUsed,
} from "@/lib/services/developerApp/developerAppService";
import { AuthenticatedApiContext } from "./context";

export const GENERIC_UNAUTHORIZED_MESSAGE = "Invalid or missing API key.";

// Strict Bearer token regex matching afd_<live|test>_<entropy>
const API_KEY_BEARER_REGEX = /^Bearer\s+(afd_(?:live|test)_[a-zA-Z0-9_-]{16,128})$/;

/**
 * Extracts and verifies the bearer API key from an incoming HTTP request.
 *
 * Security & Enumeration Resistance Guarantees:
 * - Returns the AuthenticatedApiContext on successful verification.
 * - Returns null for ALL failure modes (missing header, invalid prefix/format,
 *   non-existent key, revoked key, expired key, suspended/revoked parent app).
 * - Never logs or reveals raw secrets, key hashes, or failure reasons.
 */
export async function authenticatePublicApiRequest(
    request: Request,
): Promise<AuthenticatedApiContext | null> {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
        return null;
    }

    const match = authHeader.trim().match(API_KEY_BEARER_REGEX);
    if (!match) {
        return null;
    }

    const rawKey = match[1];
    const keyHash = hashApiKey(rawKey);

    const credential = await resolveActiveApiKeyByKeyHash(keyHash);
    if (!credential) {
        return null;
    }

    // Touch lastUsedAt asynchronously in the background (fire-and-forget)
    touchApiKeyLastUsed(credential.apiKeyId).catch(() => {});

    return credential;
}
