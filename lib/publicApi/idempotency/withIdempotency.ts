import { NextResponse } from "next/server";
import {
    IDEMPOTENCY_HEADER_NAME,
    IDEMPOTENT_REPLAY_HEADER_NAME,
    MAX_IDEMPOTENCY_KEY_LENGTH,
    WithIdempotencyOptions,
} from "./idempotency.types";
import {
    acquireIdempotencyLock,
    resolveIdempotencyRecord,
    releaseIdempotencyLock,
} from "./idempotencyService";
import { getAuthenticatedApiContext } from "../context";
import { jsonError, getCurrentRequestId } from "../envelope";
import { REQUEST_ID_HEADER_NAME } from "../requestId";
import { PublicApiRouteHandler } from "../handler";

/**
 * Higher-order middleware wrapper providing robust idempotency protection for mutating endpoints.
 *
 * Capabilities:
 * - Scopes key uniqueness strictly to (workspaceId, apiKeyId, endpoint, idempotencyKey).
 * - Detects and returns cached response with `Idempotent-Replay: true` on identical retry.
 * - Detects payload mismatches and returns 409 IDEMPOTENCY_CONFLICT.
 * - Prevents concurrent execution races via database-level uniqueness lock.
 * - Enforces configurable TTL (defaults to 24 hours per Phase 1.18.1 §12.3).
 * - Safe on errors: releases lock on 5xx internal server errors.
 */
export function withIdempotency(
    handler: PublicApiRouteHandler,
    options?: WithIdempotencyOptions,
): PublicApiRouteHandler {
    return async (request: Request, ...args: any[]): Promise<Response> => {
        // Extract Idempotency-Key header (case-insensitive via Headers.get)
        const rawKey =
            request.headers.get(IDEMPOTENCY_HEADER_NAME) ||
            request.headers.get("Idempotency-Key");

        // 1. Missing header handling
        if (!rawKey || rawKey.trim().length === 0) {
            if (options?.required) {
                return jsonError(
                    "VALIDATION_ERROR",
                    "The Idempotency-Key header is required for this endpoint.",
                    {
                        status: 422,
                        details: [
                            {
                                field: "Idempotency-Key",
                                issue: "REQUIRED_HEADER_MISSING",
                                message: "Idempotency-Key header must be provided.",
                            },
                        ],
                    },
                );
            }

            // Optional by default: proceed normally without deduplication
            return handler(request, ...args);
        }

        const idempotencyKey = rawKey.trim();

        // 2. Validate key format and length
        if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
            return jsonError(
                "VALIDATION_ERROR",
                `Idempotency-Key must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
                {
                    status: 422,
                    details: [
                        {
                            field: "Idempotency-Key",
                            issue: "INVALID_HEADER_LENGTH",
                            message: `Idempotency-Key length (${idempotencyKey.length}) exceeds maximum limit of ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
                        },
                    ],
                },
            );
        }

        // 3. Resolve authenticated credentials from active context
        const auth = getAuthenticatedApiContext();
        const url = new URL(request.url);
        const endpoint =
            options?.endpoint || `${request.method.toUpperCase()} ${url.pathname}`;

        // 4. Safely extract request payload for fingerprinting
        let rawPayload: unknown = {};
        try {
            const clonedRequest = request.clone();
            const text = await clonedRequest.text();
            if (text && text.trim().length > 0) {
                try {
                    rawPayload = JSON.parse(text);
                } catch {
                    rawPayload = text;
                }
            }
        } catch {
            rawPayload = {};
        }

        // 5. Attempt to acquire idempotency lock
        const lock = await acquireIdempotencyLock({
            workspaceId: auth.workspaceId,
            apiKeyId: auth.apiKeyId,
            endpoint,
            idempotencyKey,
            requestPayload: rawPayload,
            ttlMs: options?.ttlMs,
        });

        // 6. Handle Replay (Cached Canonical Response)
        if (lock.kind === "REPLAY") {
            const requestId = getCurrentRequestId();
            const headers = new Headers();

            // 1. Copy cached response headers first
            if (lock.responseHeaders) {
                for (const [k, v] of Object.entries(lock.responseHeaders)) {
                    headers.set(k, v);
                }
            }

            // 2. Overwrite with current request trace identity & replay indicator
            headers.set(IDEMPOTENT_REPLAY_HEADER_NAME, "true");
            headers.set(REQUEST_ID_HEADER_NAME, requestId);
            headers.set("Content-Type", "application/json");

            // 3. Update envelope meta.requestId to current request ID if present
            let responseBody = lock.responseBody;
            if (
                responseBody &&
                typeof responseBody === "object" &&
                "meta" in responseBody &&
                (responseBody as any).meta &&
                typeof (responseBody as any).meta === "object"
            ) {
                responseBody = {
                    ...(responseBody as object),
                    meta: {
                        ...(responseBody as any).meta,
                        requestId,
                    },
                };
            }

            return NextResponse.json(responseBody, {
                status: lock.responseStatus,
                headers,
            });
        }

        // 7. Handle Conflict (Payload Mismatch)
        if (lock.kind === "CONFLICT") {
            return jsonError("IDEMPOTENCY_CONFLICT", lock.message, {
                status: 409,
            });
        }

        // 8. Handle In-Progress Concurrent Execution
        if (lock.kind === "IN_PROGRESS") {
            return jsonError("IDEMPOTENCY_CONFLICT", lock.message, {
                status: 409,
            });
        }

        // 9. Execute mutation handler with acquired lock
        let response: Response;
        try {
            response = await handler(request, ...args);
        } catch (error) {
            // Release lock on unhandled exception so future retries are not poisoned
            await releaseIdempotencyLock(lock.recordId);
            throw error;
        }

        // 10. Finalize and persist response
        if (response.status < 500) {
            try {
                const clonedResponse = response.clone();
                const responseBody = await clonedResponse.json();
                await resolveIdempotencyRecord({
                    recordId: lock.recordId,
                    responseStatus: response.status,
                    responseBody,
                });
            } catch {
                // Non-JSON or streaming body
            }
        } else {
            // 5xx internal server error -> release lock for safe retry
            await releaseIdempotencyLock(lock.recordId);
        }

        return response;
    };
}
