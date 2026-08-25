/**
 * Phase 1.13.10 — Delivery Retry & Exponential Backoff Engine
 * Handles automated retry scheduling, exponential backoff computation with jitter,
 * and execution of due delivery retries up to configured maxAttempts.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    NotificationDeliveryStatus,
    NotificationStatus,
} from "@/generated/prisma/enums";
import { dispatchNotificationDelivery, aggregateParentNotificationStatus } from "./deliveryDispatchService";
import { NotificationDeliveryNotFoundError } from "./notificationErrors";
import { NotificationDeliveryResult } from "./notification.types";

export interface RetryBackoffConfig {
    baseDelaySeconds?: number; // Default: 30s
    backoffMultiplier?: number; // Default: 2
    maxDelaySeconds?: number; // Default: 3600s (1 hour)
    jitterRatio?: number; // Default: 0.1 (+/- 10%)
}

const DEFAULT_CONFIG: Required<RetryBackoffConfig> = {
    baseDelaySeconds: 30,
    backoffMultiplier: 2,
    maxDelaySeconds: 3600,
    jitterRatio: 0.1,
};

/**
 * Computes deterministic exponential backoff delay in seconds with jitter.
 * Formula: min(maxDelay, baseDelay * (multiplier ** (attemptNumber - 1))) * (1 +/- jitter)
 *
 * @param attemptCount Current attempt count (e.g. 1 after 1st failure)
 * @param config Optional tuning for base delay, multiplier, max delay, and jitter
 */
export function calculateExponentialBackoff(
    attemptCount: number,
    config: RetryBackoffConfig = {},
): number {
    const base = config.baseDelaySeconds ?? DEFAULT_CONFIG.baseDelaySeconds;
    const mult = config.backoffMultiplier ?? DEFAULT_CONFIG.backoffMultiplier;
    const max = config.maxDelaySeconds ?? DEFAULT_CONFIG.maxDelaySeconds;
    const jitter = config.jitterRatio ?? DEFAULT_CONFIG.jitterRatio;

    const exponent = Math.max(0, attemptCount - 1);
    const rawDelay = base * Math.pow(mult, exponent);
    const cappedDelay = Math.min(rawDelay, max);

    // Apply deterministic or bounded random jitter
    const jitterMultiplier = 1 + (Math.random() * 2 - 1) * jitter;
    return Math.max(1, Math.round(cappedDelay * jitterMultiplier));
}

/**
 * Evaluates a FAILED delivery record and schedules its next retry attempt,
 * or transitions it to EXHAUSTED if maxAttempts is reached.
 */
export async function scheduleDeliveryRetry(
    prisma: PrismaClient | Prisma.TransactionClient,
    deliveryId: string,
    config: RetryBackoffConfig = {},
) {
    const delivery = await prisma.notificationDelivery.findUnique({
        where: { id: deliveryId },
    });

    if (!delivery) {
        throw new NotificationDeliveryNotFoundError(
            `NotificationDelivery record ${deliveryId} not found for retry scheduling.`,
        );
    }

    // Only FAILED deliveries can be scheduled for retry
    if (delivery.status !== NotificationDeliveryStatus.FAILED) {
        return delivery;
    }

    // If maxAttempts reached or exceeded, mark EXHAUSTED
    if (delivery.attemptCount >= delivery.maxAttempts) {
        const updated = await prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
                status: NotificationDeliveryStatus.EXHAUSTED,
                nextAttemptAt: null,
            },
        });

        await prisma.notificationLog.create({
            data: {
                workspaceId: delivery.workspaceId,
                notificationId: delivery.notificationId,
                deliveryId: delivery.id,
                channel: delivery.channel,
                recipient: delivery.destination,
                status: NotificationDeliveryStatus.EXHAUSTED,
                attemptNumber: delivery.attemptCount,
                provider: "RETRY_ENGINE",
                providerMessageId: null,
                errorCode: "MAX_RETRIES_EXCEEDED",
                errorMessage: `Delivery exceeded maximum retry attempts (${delivery.maxAttempts}).`,
            },
        });

        await aggregateParentNotificationStatus(prisma, delivery.notificationId);
        return updated;
    }

    // Compute next attempt timestamp
    const delaySeconds = calculateExponentialBackoff(delivery.attemptCount, config);
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);

    const updated = await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
            status: NotificationDeliveryStatus.PENDING_RETRY,
            nextAttemptAt,
        },
    });

    await prisma.notificationLog.create({
        data: {
            workspaceId: delivery.workspaceId,
            notificationId: delivery.notificationId,
            deliveryId: delivery.id,
            channel: delivery.channel,
            recipient: delivery.destination,
            status: NotificationDeliveryStatus.PENDING_RETRY,
            attemptNumber: delivery.attemptCount,
            provider: "RETRY_ENGINE",
            providerMessageId: null,
            errorCode: null,
            errorMessage: `Scheduled retry attempt #${delivery.attemptCount + 1} for ${nextAttemptAt.toISOString()} (delay: ${delaySeconds}s)`,
            metadata: {
                nextAttemptAt: nextAttemptAt.toISOString(),
                delaySeconds,
            },
        },
    });

    return updated;
}

export interface ProcessDueRetriesResult {
    processedCount: number;
    results: NotificationDeliveryResult[];
}

/**
 * Queries and executes all PENDING_RETRY deliveries whose nextAttemptAt timestamp has arrived.
 */
export async function processDueDeliveryRetries(
    prisma: PrismaClient | Prisma.TransactionClient,
    options: {
        limit?: number;
        now?: Date;
        workspaceId?: string;
    } = {},
): Promise<ProcessDueRetriesResult> {
    const limit = options.limit || 50;
    const now = options.now || new Date();

    const dueDeliveries = await prisma.notificationDelivery.findMany({
        where: {
            status: NotificationDeliveryStatus.PENDING_RETRY,
            nextAttemptAt: { lte: now },
            ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        },
        orderBy: { nextAttemptAt: "asc" },
        take: limit,
    });

    const results: NotificationDeliveryResult[] = [];

    for (const delivery of dueDeliveries) {
        // Reset status to PENDING so dispatchNotificationDelivery can process it
        await prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
                status: NotificationDeliveryStatus.PENDING,
            },
        });

        const dispatchResult = await dispatchNotificationDelivery(prisma, delivery.id);
        results.push(dispatchResult);

        // If it failed again and is retryable, schedule next retry attempt
        if (dispatchResult.status === NotificationDeliveryStatus.FAILED) {
            await scheduleDeliveryRetry(prisma, delivery.id);
        }
    }

    return {
        processedCount: dueDeliveries.length,
        results,
    };
}
