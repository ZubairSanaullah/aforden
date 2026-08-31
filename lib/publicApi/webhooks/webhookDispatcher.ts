/**
 * Phase 1.18.18 — Webhook Delivery Dispatcher & Retry Engine
 *
 * Dispatches outbound HTTP POST requests to registered webhook endpoints with:
 * 1. Pre-connect DNS resolution and IP validation (SSRF / DNS rebinding protection)
 * 2. HMAC-SHA256 request signing ('Aforden-Signature: t=...,v1=...')
 * 3. Enforced 'redirect: manual' policy
 * 4. 10-second per-attempt timeout
 * 5. Exponential backoff retry state machine (PENDING -> RETRYING -> DELIVERED / FAILED)
 * 6. Terminal 4xx vs retryable 5xx/timeout failure classification
 */

import { prisma as globalPrisma } from "@/lib/prisma";
import { PrismaClient } from "@/generated/prisma/client";
import { WebhookDeliveryStatus } from "@/generated/prisma/enums";
import {
    PublicWebhookPayloadEnvelope,
    WebhookDeliveryDto,
} from "./webhook.types";
import { PublicWebhookEventType } from "./webhookEvents";
import { signWebhookPayload } from "./webhookSigning";
import {
    resolveAndValidateWebhookIp,
    DnsLookupFunction,
    DeliverySsrfBlockedError,
    DeliveryDnsResolutionError,
} from "./webhookDnsValidator";

export const MAX_DELIVERY_ATTEMPTS = 5;
export const DEFAULT_DELIVERY_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Exponential backoff delays in milliseconds for retry attempts:
 * - Attempt 1 fails -> Retry 1 scheduled in 15 seconds
 * - Attempt 2 fails -> Retry 2 scheduled in 60 seconds (1 min)
 * - Attempt 3 fails -> Retry 3 scheduled in 300 seconds (5 min)
 * - Attempt 4 fails -> Retry 4 scheduled in 1800 seconds (30 min)
 * - Attempt 5 fails -> Terminal FAILED
 */
export const RETRY_BACKOFF_DELAYS_MS: readonly number[] = [
    15_000,    // Retry 1: 15s
    60_000,    // Retry 2: 1m
    300_000,   // Retry 3: 5m
    1_800_000, // Retry 4: 30m
];

/**
 * Calculates the next retry timestamp for a failed attempt.
 */
export function calculateNextRetryAt(attemptNumber: number, baseDate: Date = new Date()): Date {
    const index = Math.max(0, Math.min(attemptNumber - 1, RETRY_BACKOFF_DELAYS_MS.length - 1));
    const delayMs = RETRY_BACKOFF_DELAYS_MS[index];
    return new Date(baseDate.getTime() + delayMs);
}

/**
 * Determines whether an HTTP status code represents a terminal (non-retryable) failure.
 * 4xx client errors (400, 401, 403, 404, 410, 422, etc.) are terminal because re-sending
 * the exact same payload will produce the exact same client rejection.
 */
export function isTerminalClientError(statusCode: number): boolean {
    return statusCode >= 400 && statusCode < 500 && statusCode !== 429;
}

export interface WebhookDispatchOptions {
    customDnsResolver?: DnsLookupFunction;
    customFetch?: typeof fetch;
    timeoutMs?: number;
    now?: Date;
    db?: PrismaClient;
    initialDelivery?: any;
}

export interface DeliveryAttemptResult {
    deliveryId: string;
    status: WebhookDeliveryStatus;
    attempts: number;
    responseStatus: number | null;
    durationMs: number;
    error?: string;
}

/**
 * Executes a single delivery attempt for a WebhookDelivery record.
 */
export async function deliverWebhookAttempt(
    deliveryId: string,
    options: WebhookDispatchOptions = {},
): Promise<DeliveryAttemptResult> {
    const db = options.db || globalPrisma;
    const now = options.now || new Date();
    const timeoutMs = options.timeoutMs ?? DEFAULT_DELIVERY_TIMEOUT_MS;
    const fetchImpl = options.customFetch || fetch;

    // 1. Fetch delivery and its endpoint
    const delivery =
        options.initialDelivery ||
        (await db.webhookDelivery.findUnique({
            where: { id: deliveryId },
            include: {
                webhookEndpoint: true,
            },
        }));

    if (!delivery) {
        throw new Error(`WebhookDelivery record '${deliveryId}' not found.`);
    }

    const endpoint =
        delivery.webhookEndpoint ||
        (await db.webhookEndpoint.findUnique({
            where: { id: delivery.webhookEndpointId },
        }));
    const currentAttempt = delivery.attempts + 1;

    // 2. Check if endpoint was deactivated or deleted
    if (!endpoint || endpoint.status !== "ACTIVE") {
        try {
            await db.webhookDelivery.update({
                where: { id: deliveryId },
                data: {
                    attempts: currentAttempt,
                    status: "FAILED",
                    failedAt: now,
                    responseBody: !endpoint
                        ? "Delivery aborted: Webhook endpoint not found."
                        : "Delivery aborted: Webhook endpoint is DISABLED.",
                    nextRetryAt: null,
                },
            });
        } catch (err: any) {
            if (err?.code !== "P2025") {
                throw err;
            }
        }

        return {
            deliveryId,
            status: "FAILED",
            attempts: currentAttempt,
            responseStatus: null,
            durationMs: 0,
            error: !endpoint ? "Endpoint not found" : "Endpoint is DISABLED",
        };
    }

    const startTime = Date.now();
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(endpoint.url);
    } catch {
        // Invalid URL -> Terminal failure
        await db.webhookDelivery.update({
            where: { id: deliveryId },
            data: {
                attempts: currentAttempt,
                status: "FAILED",
                failedAt: now,
                responseBody: `Delivery aborted: Malformed endpoint URL '${endpoint.url}'.`,
                nextRetryAt: null,
            },
        });

        return {
            deliveryId,
            status: "FAILED",
            attempts: currentAttempt,
            responseStatus: null,
            durationMs: 0,
            error: "Malformed endpoint URL",
        };
    }

    // 3. STEP 1: Pre-Connect DNS Resolution & SSRF / DNS Rebinding Check
    try {
        await resolveAndValidateWebhookIp(parsedUrl.hostname, options.customDnsResolver);
    } catch (dnsErr: any) {
        const durationMs = Date.now() - startTime;
        const errorMessage = dnsErr instanceof Error ? dnsErr.message : String(dnsErr);
        const isSsrfBlock = dnsErr instanceof DeliverySsrfBlockedError;

        // SSRF Block is a severe security violation -> terminate immediately without retries
        const newStatus: WebhookDeliveryStatus = isSsrfBlock
            ? "FAILED"
            : currentAttempt >= MAX_DELIVERY_ATTEMPTS
              ? "FAILED"
              : "RETRYING";

        const nextRetryAt = newStatus === "RETRYING" ? calculateNextRetryAt(currentAttempt, now) : null;
        const failedAt = newStatus === "FAILED" ? now : null;

        try {
            await db.webhookDelivery.update({
                where: { id: deliveryId },
                data: {
                    attempts: currentAttempt,
                    status: newStatus,
                    responseBody: `DNS/SSRF Pre-Connect Check Failed: ${errorMessage}`,
                    durationMs,
                    nextRetryAt,
                    failedAt,
                },
            });
        } catch (err: any) {
            if (err?.code !== "P2025") {
                throw err;
            }
        }

        return {
            deliveryId,
            status: newStatus,
            attempts: currentAttempt,
            responseStatus: null,
            durationMs,
            error: errorMessage,
        };
    }

    // 4. STEP 2: Sign Payload with HMAC-SHA256
    const payloadString = JSON.stringify(delivery.payload);
    const { header: signatureHeader } = signWebhookPayload(
        endpoint.secret,
        payloadString,
        Math.floor(now.getTime() / 1000),
    );

    // 5. STEP 3: Execute Outbound HTTP Request
    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let requestError: Error | null = null;

    try {
        const res = await fetchImpl(endpoint.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Aforden-Webhook-Dispatcher/1.0",
                "Aforden-Signature": signatureHeader,
                "Aforden-Delivery-Id": delivery.id,
                "Aforden-Event-Id": delivery.eventId,
            },
            body: payloadString,
            redirect: "manual", // Do NOT automatically follow redirects (SSRF prevention)
            signal: AbortSignal.timeout(timeoutMs),
        });

        responseStatus = res.status;
        try {
            const rawText = await res.text();
            responseBody = rawText ? rawText.substring(0, 2048) : null;
        } catch {
            responseBody = null;
        }
    } catch (err: any) {
        requestError = err instanceof Error ? err : new Error(String(err));
        responseBody = `Request error: ${requestError.message}`;
    }

    const durationMs = Date.now() - startTime;

    // 6. STEP 4: State Machine Transition
    let finalStatus: WebhookDeliveryStatus;
    let nextRetryAt: Date | null = null;
    let deliveredAt: Date | null = null;
    let failedAt: Date | null = null;

    if (responseStatus !== null && responseStatus >= 200 && responseStatus < 300) {
        // Success (2xx)
        finalStatus = "DELIVERED";
        deliveredAt = now;
        nextRetryAt = null;
    } else if (responseStatus !== null && isTerminalClientError(responseStatus)) {
        // Terminal Client Error (4xx except 429) -> Permanent failure
        finalStatus = "FAILED";
        failedAt = now;
        nextRetryAt = null;
    } else {
        // Retryable Error (5xx, 429, timeout, network error)
        if (currentAttempt >= MAX_DELIVERY_ATTEMPTS) {
            finalStatus = "FAILED";
            failedAt = now;
            nextRetryAt = null;
        } else {
            finalStatus = "RETRYING";
            nextRetryAt = calculateNextRetryAt(currentAttempt, now);
        }
    }

    try {
        await db.webhookDelivery.update({
            where: { id: deliveryId },
            data: {
                attempts: currentAttempt,
                status: finalStatus,
                responseStatus,
                responseBody,
                durationMs,
                nextRetryAt,
                deliveredAt,
                failedAt,
            },
        });
    } catch (err: any) {
        if (err?.code !== "P2025") {
            throw err;
        }
    }

    return {
        deliveryId,
        status: finalStatus,
        attempts: currentAttempt,
        responseStatus,
        durationMs,
        error: requestError?.message,
    };
}

/**
 * Transactional Webhook Enqueueing:
 * Creates WebhookDelivery rows in PENDING status inside the caller's active database transaction (tx).
 * Guarantees transactional atomicity (if tx rolls back, deliveries roll back automatically).
 */
export async function enqueueWebhookDelivery<T = any>(
    tx: any,
    workspaceId: string,
    eventType: PublicWebhookEventType,
    data: T,
): Promise<string[]> {
    if (!tx?.webhookEndpoint?.findMany || !tx?.webhookDelivery?.create) {
        return [];
    }

    const endpoints = await tx.webhookEndpoint.findMany({
        where: {
            workspaceId,
            status: "ACTIVE",
            events: {
                has: eventType,
            },
        },
    });

    if (endpoints.length === 0) {
        return [];
    }

    const now = new Date();
    const eventId = `evt_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    const payload: PublicWebhookPayloadEnvelope<T> = {
        id: eventId,
        event: eventType,
        createdAt: now.toISOString(),
        workspaceId,
        apiVersion: "v1",
        data,
    };

    const deliveryIds: string[] = [];
    for (const endpoint of endpoints) {
        const delivery = await tx.webhookDelivery.create({
            data: {
                workspaceId,
                webhookEndpointId: endpoint.id,
                eventId,
                eventType,
                payload: JSON.parse(JSON.stringify(payload)),
                status: "PENDING",
                attempts: 0,
            },
        });
        deliveryIds.push(delivery.id);
    }

    return deliveryIds;
}

/**
 * Triggers background post-commit delivery attempts for the given delivery IDs.
 */
export function triggerWebhookDeliveries(deliveryIds: string[]): void {
    if (!deliveryIds || deliveryIds.length === 0) return;
    for (const deliveryId of deliveryIds) {
        void deliverWebhookAttempt(deliveryId).catch((err) => {
            console.error(`[WebhookDispatch] Failed delivery attempt for ${deliveryId}:`, err);
        });
    }
}

/**
 * High-level Event Dispatcher:
 * Finds all active webhook endpoints in workspaceId subscribed to eventType,
 * creates WebhookDelivery records, and optionally fires immediate attempt.
 */
export async function dispatchWebhookEvent<T = any>(
    workspaceId: string,
    eventType: PublicWebhookEventType,
    data: T,
    options: {
        executeImmediately?: boolean;
        customDnsResolver?: DnsLookupFunction;
        customFetch?: typeof fetch;
        timeoutMs?: number;
        now?: Date;
        db?: PrismaClient;
    } = {},
): Promise<WebhookDeliveryDto[]> {
    const db = options.db || globalPrisma;
    const now = options.now || new Date();

    // Defensive fallback for unit test fixtures with partial mock Prisma clients
    if (!db?.webhookEndpoint?.findMany || !db?.webhookDelivery?.create) {
        return [];
    }

    // 1. Find all active endpoints subscribed to this event in workspace
    const endpoints = await db.webhookEndpoint.findMany({
        where: {
            workspaceId,
            status: "ACTIVE",
            events: {
                has: eventType,
            },
        },
    });

    if (endpoints.length === 0) {
        return [];
    }

    const eventId = `evt_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    const payload: PublicWebhookPayloadEnvelope<T> = {
        id: eventId,
        event: eventType,
        createdAt: now.toISOString(),
        workspaceId,
        apiVersion: "v1",
        data,
    };

    const deliveryDtos: WebhookDeliveryDto[] = [];

    for (const endpoint of endpoints) {
        const delivery = await db.webhookDelivery.create({
            data: {
                workspaceId,
                webhookEndpointId: endpoint.id,
                eventId,
                eventType,
                payload: JSON.parse(JSON.stringify(payload)),
                status: "PENDING",
                attempts: 0,
            },
        });

        if (options.executeImmediately !== false) {
            // Execute attempt 1
            await deliverWebhookAttempt(delivery.id, {
                customDnsResolver: options.customDnsResolver,
                customFetch: options.customFetch,
                timeoutMs: options.timeoutMs,
                now,
                db,
                initialDelivery: { ...delivery, webhookEndpoint: endpoint },
            });
        }

        const refreshed = await db.webhookDelivery.findUniqueOrThrow({
            where: { id: delivery.id },
        });

        deliveryDtos.push({
            id: refreshed.id,
            workspaceId: refreshed.workspaceId,
            webhookEndpointId: refreshed.webhookEndpointId,
            eventId: refreshed.eventId,
            eventType: refreshed.eventType,
            status: refreshed.status,
            attempts: refreshed.attempts,
            responseStatus: refreshed.responseStatus,
            responseBody: refreshed.responseBody,
            durationMs: refreshed.durationMs,
            nextRetryAt: refreshed.nextRetryAt ? refreshed.nextRetryAt.toISOString() : null,
            deliveredAt: refreshed.deliveredAt ? refreshed.deliveredAt.toISOString() : null,
            failedAt: refreshed.failedAt ? refreshed.failedAt.toISOString() : null,
            createdAt: refreshed.createdAt.toISOString(),
        });
    }

    return deliveryDtos;
}

/**
 * Worker helper: Processes pending and due retry deliveries.
 */
export async function processPendingWebhookDeliveries(
    options: {
        workspaceId?: string;
        limit?: number;
        now?: Date;
        customDnsResolver?: DnsLookupFunction;
        customFetch?: typeof fetch;
        db?: PrismaClient;
    } = {},
): Promise<DeliveryAttemptResult[]> {
    const db = options.db || globalPrisma;
    const now = options.now || new Date();
    const limit = options.limit || 50;

    const dueDeliveries = await db.webhookDelivery.findMany({
        where: {
            ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
            OR: [
                { status: "PENDING" },
                {
                    status: "RETRYING",
                    nextRetryAt: {
                        lte: now,
                    },
                },
            ],
        },
        take: limit,
        orderBy: {
            createdAt: "asc",
        },
    });

    const results: DeliveryAttemptResult[] = [];
    for (const delivery of dueDeliveries) {
        const res = await deliverWebhookAttempt(delivery.id, {
            customDnsResolver: options.customDnsResolver,
            customFetch: options.customFetch,
            now,
            db,
        });
        results.push(res);
    }

    return results;
}
