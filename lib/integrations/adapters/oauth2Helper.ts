/**
 * Phase 1.17.8 — Shared OAuth2 Token-Rotation & In-Flight Concurrency Mutex Helper
 * Manages OAuth2 token expiration checks, token refresh exchanges, and single-flight
 * deduplication mutex per connectionId to prevent racing single-use refresh tokens per Phase 1.17.1 §4.2.
 */

export interface OAuth2TokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number | string; // Unix timestamp in ms or ISO string
  tokenType?: string;
  scope?: string;
  realmId?: string; // QuickBooks company ID
  [key: string]: unknown;
}

export interface RefreshOAuth2TokenOptions {
  connectionId: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  currentTokens: OAuth2TokenPayload;
  expiryBufferSeconds?: number;
  customParams?: Record<string, string>;
  useBasicAuth?: boolean;
  now?: number;
  onTokenRefreshed?: (updatedTokens: OAuth2TokenPayload) => Promise<void>;
}

// In-flight refresh Promise registry keyed by connectionId (or secretId)
const inFlightRefreshMap = new Map<string, Promise<OAuth2TokenPayload>>();

/**
 * Checks whether an OAuth2 token is expired or within the expiry buffer window.
 */
export function isOAuth2TokenExpired(
  tokens: OAuth2TokenPayload,
  bufferSeconds: number = 60,
  nowMs: number = Date.now()
): boolean {
  if (!tokens.expiresAt) {
    return false; // Non-expiring or unknown expiry token
  }

  const expiryMs =
    typeof tokens.expiresAt === "number"
      ? tokens.expiresAt
      : new Date(tokens.expiresAt).getTime();

  if (isNaN(expiryMs)) {
    return false;
  }

  return nowMs + bufferSeconds * 1000 >= expiryMs;
}

/**
 * Refreshes an expired OAuth2 token using a single-flight mutex per connection.
 * Concurrent callers for the same connectionId share the exact same refresh promise,
 * preventing race conditions on single-use refresh tokens.
 */
export async function refreshOAuth2TokenWithMutex(
  options: RefreshOAuth2TokenOptions
): Promise<OAuth2TokenPayload> {
  const {
    connectionId,
    tokenEndpoint,
    clientId,
    clientSecret,
    currentTokens,
    expiryBufferSeconds = 60,
    customParams = {},
    useBasicAuth = true,
    now = Date.now(),
    onTokenRefreshed,
  } = options;

  // 1. Fast-path: Token is still valid and outside expiry buffer
  if (!isOAuth2TokenExpired(currentTokens, expiryBufferSeconds, now)) {
    return currentTokens;
  }

  if (!currentTokens.refreshToken) {
    throw new Error(
      `[OAuth2Helper] Cannot refresh OAuth2 token for connection '${connectionId}': No refreshToken present.`
    );
  }

  // 2. Concurrency Mutex: Check if a refresh for this connection is already in flight
  const existingRefreshPromise = inFlightRefreshMap.get(connectionId);
  if (existingRefreshPromise) {
    return existingRefreshPromise;
  }

  // 3. Initiate single-flight refresh operation
  const refreshPromise = (async () => {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "Aforden-Integration-Engine/1.0",
      };

      const bodyParams = new URLSearchParams();
      bodyParams.set("grant_type", "refresh_token");
      bodyParams.set("refresh_token", currentTokens.refreshToken!);

      if (useBasicAuth) {
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        headers.Authorization = `Basic ${basicAuth}`;
      } else {
        bodyParams.set("client_id", clientId);
        bodyParams.set("client_secret", clientSecret);
      }

      for (const [key, val] of Object.entries(customParams)) {
        bodyParams.set(key, val);
      }

      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers,
        body: bodyParams.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(
          `[OAuth2Helper] Token refresh failed with HTTP ${response.status}: ${JSON.stringify(errorBody)}`
        );
      }

      const responseJson = (await response.json()) as Record<string, unknown>;

      const expiresInSeconds =
        typeof responseJson.expires_in === "number"
          ? responseJson.expires_in
          : parseInt(String(responseJson.expires_in || "3600"), 10);

      const updatedTokens: OAuth2TokenPayload = {
        ...currentTokens,
        accessToken: String(responseJson.access_token),
        refreshToken:
          typeof responseJson.refresh_token === "string"
            ? responseJson.refresh_token
            : currentTokens.refreshToken,
        expiresAt: Date.now() + expiresInSeconds * 1000,
        tokenType:
          typeof responseJson.token_type === "string"
            ? responseJson.token_type
            : currentTokens.tokenType || "Bearer",
        scope:
          typeof responseJson.scope === "string"
            ? responseJson.scope
            : currentTokens.scope,
      };

      if (onTokenRefreshed) {
        await onTokenRefreshed(updatedTokens);
      }

      return updatedTokens;
    } finally {
      // Clear from in-flight map once resolved or rejected
      inFlightRefreshMap.delete(connectionId);
    }
  })();

  inFlightRefreshMap.set(connectionId, refreshPromise);
  return refreshPromise;
}

/**
 * Resets the in-flight refresh map. Intended for test isolation.
 */
export function clearInFlightOAuth2Refreshes(): void {
  inFlightRefreshMap.clear();
}
