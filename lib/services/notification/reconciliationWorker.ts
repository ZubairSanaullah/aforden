/**
 * Phase 1.13.10 — Stuck-PROCESSING Reconciliation Scanner & Recovery Worker
 * Detects and recovers NotificationDelivery and NotificationOutbox rows stuck in
 * PROCESSING status due to ungraceful worker crashes, container restarts, or network dropouts.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    NotificationDeliveryStatus,
    NotificationOutboxStatus,
} from "@/generated/prisma/enums";
import { aggregateParentNotificationStatus } from "./deliveryDispatchService";

export interface ReconciliationOptions {
    staleThresholdMinutes?: number; // Default: 10 minutes
    limit?: number; // Default: 50
    now?: Date;
    workspaceId?: string;
}

export interface ReconcileDeliveriesResult {
    scannedCount: number;
    recoveredCount: number;
    exhaustedCount: number;
    reconciledDeliveryIds: string[];
}

export interface ReconcileOutboxResult {
    scannedCount: number;
    recoveredCount: number;
    failedCount: number;
    reconciledOutboxIds: string[];
}

/**
 * Sweeps the database for NotificationDelivery records stuck in PROCESSING state.
 */
export async function reconcileStuckDeliveries(
    prisma: PrismaClient | Prisma.TransactionClient,
    options: ReconciliationOptions = {},
): Promise<ReconcileDeliveriesResult> {
    const staleMinutes = options.staleThresholdMinutes ?? 10;
    const limit = options.limit ?? 50;
    const now = options.now ?? new Date();
    const staleCutoff = new Date(now.getTime() - staleMinutes * 60 * 1000);

    const stuckDeliveries = await prisma.notificationDelivery.findMany({
        where: {
            status: NotificationDeliveryStatus.PROCESSING,
            lastAttemptAt: { lte: staleCutoff },
            ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        },
        take: limit,
        orderBy: { lastAttemptAt: "asc" },
    });

    let recoveredCount = 0;
    let exhaustedCount = 0;
    const reconciledDeliveryIds: string[] = [];

    for (const delivery of stuckDeliveries) {
        if (delivery.attemptCount < delivery.maxAttempts) {
            // Recoverable: schedule for immediate retry
            await prisma.notificationDelivery.update({
                where: { id: delivery.id },
                data: {
                    status: NotificationDeliveryStatus.PENDING_RETRY,
                    nextAttemptAt: now,
                    errorMessage: "Recovered from stuck PROCESSING state by reconciliation worker.",
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
                    provider: "RECONCILIATION_WORKER",
                    providerMessageId: null,
                    errorCode: "STUCK_PROCESSING_RECOVERED",
                    errorMessage: `Reconciled delivery stuck in PROCESSING for >${staleMinutes}m. Rescheduled for retry.`,
                    metadata: {
                        staleMinutes,
                        previousLastAttemptAt: delivery.lastAttemptAt?.toISOString(),
                    },
                },
            });

            recoveredCount++;
        } else {
            // Max attempts reached: mark EXHAUSTED
            await prisma.notificationDelivery.update({
                where: { id: delivery.id },
                data: {
                    status: NotificationDeliveryStatus.EXHAUSTED,
                    errorMessage: `Delivery timed out in PROCESSING state and exceeded max attempts (${delivery.maxAttempts}).`,
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
                    provider: "RECONCILIATION_WORKER",
                    providerMessageId: null,
                    errorCode: "STUCK_PROCESSING_EXHAUSTED",
                    errorMessage: `Delivery timed out in PROCESSING for >${staleMinutes}m and exhausted max attempts.`,
                },
            });

            await aggregateParentNotificationStatus(prisma, delivery.notificationId);
            exhaustedCount++;
        }

        reconciledDeliveryIds.push(delivery.id);
    }

    return {
        scannedCount: stuckDeliveries.length,
        recoveredCount,
        exhaustedCount,
        reconciledDeliveryIds,
    };
}

/**
 * Sweeps the database for NotificationOutbox rows stuck in PROCESSING state.
 */
export async function reconcileStuckOutboxItems(
    prisma: PrismaClient | Prisma.TransactionClient,
    options: ReconciliationOptions = {},
): Promise<ReconcileOutboxResult> {
    const staleMinutes = options.staleThresholdMinutes ?? 10;
    const limit = options.limit ?? 50;
    const now = options.now ?? new Date();
    const staleCutoff = new Date(now.getTime() - staleMinutes * 60 * 1000);

    const stuckOutboxItems = await prisma.notificationOutbox.findMany({
        where: {
            status: NotificationOutboxStatus.PROCESSING,
            createdAt: { lte: staleCutoff },
            ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        },
        take: limit,
        orderBy: { createdAt: "asc" },
    });

    let recoveredCount = 0;
    let failedCount = 0;
    const reconciledOutboxIds: string[] = [];

    const MAX_OUTBOX_ATTEMPTS = 5;

    for (const item of stuckOutboxItems) {
        if (item.attemptCount < MAX_OUTBOX_ATTEMPTS) {
            await prisma.notificationOutbox.update({
                where: { id: item.id },
                data: {
                    status: NotificationOutboxStatus.PENDING,
                    errorMessage: "Recovered from stuck PROCESSING state by reconciliation worker.",
                },
            });
            recoveredCount++;
        } else {
            await prisma.notificationOutbox.update({
                where: { id: item.id },
                data: {
                    status: NotificationOutboxStatus.FAILED,
                    errorMessage: `Outbox processing timed out in PROCESSING state and exceeded max attempts (${MAX_OUTBOX_ATTEMPTS}).`,
                },
            });
            failedCount++;
        }

        reconciledOutboxIds.push(item.id);
    }

    return {
        scannedCount: stuckOutboxItems.length,
        recoveredCount,
        failedCount,
        reconciledOutboxIds,
    };
}
