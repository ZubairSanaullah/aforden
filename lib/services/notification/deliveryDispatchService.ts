/**
 * Phase 1.13.7 — Single-Attempt Delivery Dispatch Service
 * Dispatches individual NotificationDelivery records through concrete channel adapters,
 * updates delivery statuses, records durable audit logs, and aggregates parent Notification status.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    NotificationDeliveryStatus,
    NotificationStatus,
    NotificationChannel,
} from "@/generated/prisma/enums";
import { NotificationProviderFactory } from "./providers/notificationProviderFactory";
import { renderNotificationContent } from "./templateService";
import {
    NotificationDeliveryNotFoundError,
    NotificationTemplateNotFoundError,
} from "./notificationErrors";
import { NotificationDeliveryResult } from "./notification.types";

/**
 * Dispatches a single NotificationDelivery attempt through the configured provider adapter.
 *
 * ARCHITECTURAL GUARANTEES:
 * 1. Transitions delivery status PENDING -> PROCESSING before invoking the provider.
 *    (Known Gap for Phase 1.13.10: A crash mid-dispatch leaving status in PROCESSING
 *    will be reconciled and recovered by the Phase 1.13.10 reconciliation worker).
 * 2. Renders channel-specific notification templates via Phase 1.13.5 renderNotificationContent.
 * 3. Catches all provider exceptions internally; never allows unhandled provider crashes to escape.
 * 4. Logs every attempt (success or failure) to NotificationLog for immutable auditing.
 * 5. Recomputes parent Notification aggregate status according to Section 3.3 rules.
 */
export async function dispatchNotificationDelivery(
    prisma: PrismaClient | Prisma.TransactionClient,
    deliveryId: string,
): Promise<NotificationDeliveryResult> {
    // 1. Fetch delivery record with parent notification
    const delivery = await prisma.notificationDelivery.findUnique({
        where: { id: deliveryId },
        include: { notification: true },
    });

    if (!delivery) {
        throw new NotificationDeliveryNotFoundError(
            `NotificationDelivery record ${deliveryId} not found.`,
        );
    }

    // Guard: Only process PENDING or PENDING_RETRY deliveries
    if (
        delivery.status !== NotificationDeliveryStatus.PENDING &&
        delivery.status !== NotificationDeliveryStatus.PENDING_RETRY
    ) {
        return {
            deliveryId: delivery.id,
            notificationId: delivery.notificationId,
            channel: delivery.channel,
            status: delivery.status,
            providerMessageId: delivery.providerMessageId,
            errorCode: delivery.errorCode,
            errorMessage: delivery.errorMessage,
            attemptCount: delivery.attemptCount,
        };
    }

    // 2. Transition status PENDING -> PROCESSING
    await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
            status: NotificationDeliveryStatus.PROCESSING,
            lastAttemptAt: new Date(),
        },
    });

    // 3. Resolve event payload from parent notification metadata or outbox
    let payload: Record<string, unknown> = {};
    const metadata = (delivery.notification.metadata || {}) as Record<string, any>;
    if (metadata.outboxId) {
        const outbox = await prisma.notificationOutbox.findUnique({
            where: { id: metadata.outboxId },
        });
        if (outbox && outbox.payload) {
            payload =
                typeof outbox.payload === "string"
                    ? JSON.parse(outbox.payload)
                    : (outbox.payload as Record<string, unknown>);
        }
    } else if (metadata.payload) {
        payload = metadata.payload;
    }

    // 4. Render template content
    let renderedSubject: string | undefined;
    let renderedBody = "";
    let renderedBodyHtml: string | undefined;

    try {
        const rendered = await renderNotificationContent(
            prisma,
            delivery.workspaceId,
            delivery.notification.eventType,
            delivery.channel,
            payload,
        );
        renderedSubject = rendered.subject;
        renderedBody = rendered.body;
        renderedBodyHtml = rendered.bodyHtml;
    } catch (templateError: any) {
        // If template resolution or compilation fails, mark delivery EXHAUSTED immediately
        const newAttemptCount = delivery.attemptCount + 1;
        const errMessage =
            templateError instanceof Error
                ? templateError.message
                : "Template rendering failed.";

        await prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
                status: NotificationDeliveryStatus.EXHAUSTED,
                attemptCount: newAttemptCount,
                errorCode: "TEMPLATE_ERROR",
                errorMessage: errMessage,
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
                attemptNumber: newAttemptCount,
                provider: "TEMPLATE_ENGINE",
                providerMessageId: null,
                errorCode: "TEMPLATE_ERROR",
                errorMessage: errMessage,
                metadata: {
                    channel: delivery.channel,
                    recipientType: delivery.recipientType,
                },
            },
        });

        await aggregateParentNotificationStatus(prisma, delivery.notificationId);

        return {
            deliveryId: delivery.id,
            notificationId: delivery.notificationId,
            channel: delivery.channel,
            status: NotificationDeliveryStatus.EXHAUSTED,
            errorCode: "TEMPLATE_ERROR",
            errorMessage: errMessage,
            attemptCount: newAttemptCount,
        };
    }

    // 5. Invoke channel adapter
    let isSuccess = false;
    let providerName = "UNKNOWN";
    let providerMessageId: string | null = null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    let isRetryable = false;

    try {
        switch (delivery.channel) {
            case NotificationChannel.EMAIL: {
                const provider = NotificationProviderFactory.getEmailProvider();
                providerName = provider.name;
                const result = await provider.sendEmail({
                    workspaceId: delivery.workspaceId,
                    to: delivery.destination,
                    subject: renderedSubject || "Aforden Notification",
                    bodyText: renderedBody,
                    bodyHtml: renderedBodyHtml,
                    metadata: {
                        notificationId: delivery.notificationId,
                        deliveryId: delivery.id,
                    },
                });
                isSuccess = result.success;
                providerMessageId = result.providerMessageId || null;
                errorCode = result.errorCode || null;
                errorMessage = result.errorMessage || null;
                isRetryable = result.isRetryable;
                break;
            }

            case NotificationChannel.IN_APP: {
                const provider = NotificationProviderFactory.getInAppProvider();
                providerName = provider.name;
                const result = await provider.publishInApp(prisma, {
                    workspaceId: delivery.workspaceId,
                    memberId: delivery.recipientId,
                    notificationId: delivery.notificationId,
                    title: renderedSubject || renderedBody.slice(0, 60),
                    body: renderedBody,
                    sourceEntity: delivery.notification.sourceEntity,
                    sourceId: delivery.notification.sourceId,
                });
                isSuccess = result.success;
                providerMessageId = result.feedItemId || null;
                errorCode = result.errorCode || null;
                errorMessage = result.errorMessage || null;
                isRetryable = false; // DB write failure is non-retryable at provider level
                break;
            }

            case NotificationChannel.SMS: {
                const provider = NotificationProviderFactory.getSMSProvider();
                providerName = provider.name;
                const result = await provider.sendSms({
                    workspaceId: delivery.workspaceId,
                    to: delivery.destination,
                    body: renderedBody,
                    metadata: {
                        notificationId: delivery.notificationId,
                        deliveryId: delivery.id,
                    },
                });
                isSuccess = result.success;
                providerMessageId = result.providerMessageId || null;
                errorCode = result.errorCode || null;
                errorMessage = result.errorMessage || null;
                isRetryable = result.isRetryable;
                break;
            }

            case NotificationChannel.PUSH: {
                const provider = NotificationProviderFactory.getPushProvider();
                providerName = provider.name;
                const result = await provider.sendPush({
                    workspaceId: delivery.workspaceId,
                    userId: delivery.destination,
                    title: renderedSubject || "Aforden Notification",
                    body: renderedBody,
                    data: {
                        notificationId: delivery.notificationId,
                        deliveryId: delivery.id,
                    },
                });
                isSuccess = result.success;
                providerMessageId = result.providerMessageId || null;
                errorCode = result.errorCode || null;
                errorMessage = result.errorMessage || null;
                isRetryable = result.isRetryable;
                break;
            }
        }
    } catch (unexpectedError: any) {
        isSuccess = false;
        errorCode =
            unexpectedError.name && unexpectedError.name !== "Error"
                ? unexpectedError.name
                : "PROVIDER_UNCAUGHT_EXCEPTION";
        errorMessage =
            unexpectedError.message || "Provider raised an uncaught exception.";
        isRetryable = false;
    }

    // 6. Update delivery status
    const newAttemptCount = delivery.attemptCount + 1;
    let finalDeliveryStatus: NotificationDeliveryStatus;

    if (isSuccess) {
        finalDeliveryStatus = NotificationDeliveryStatus.DELIVERED;
        await prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
                status: finalDeliveryStatus,
                deliveredAt: new Date(),
                providerMessageId,
                attemptCount: newAttemptCount,
                errorCode: null,
                errorMessage: null,
            },
        });
    } else {
        // If retryable and attempts remain, set FAILED (1.13.10 will transition to PENDING_RETRY)
        // If non-retryable or maxAttempts exhausted, set EXHAUSTED
        if (isRetryable && newAttemptCount < delivery.maxAttempts) {
            finalDeliveryStatus = NotificationDeliveryStatus.FAILED;
        } else {
            finalDeliveryStatus = NotificationDeliveryStatus.EXHAUSTED;
        }

        await prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
                status: finalDeliveryStatus,
                attemptCount: newAttemptCount,
                errorCode: errorCode || "DISPATCH_FAILED",
                errorMessage: errorMessage || "Notification dispatch failed.",
            },
        });
    }

    // 7. Write durable audit log
    await prisma.notificationLog.create({
        data: {
            workspaceId: delivery.workspaceId,
            notificationId: delivery.notificationId,
            deliveryId: delivery.id,
            channel: delivery.channel,
            recipient: delivery.destination,
            status: finalDeliveryStatus,
            attemptNumber: newAttemptCount,
            provider: providerName,
            providerMessageId: providerMessageId || null,
            errorCode: errorCode || null,
            errorMessage: errorMessage || null,
            metadata: {
                recipientType: delivery.recipientType,
                channel: delivery.channel,
            },
        },
    });

    // 8. Recompute parent Notification aggregate status
    await aggregateParentNotificationStatus(prisma, delivery.notificationId);

    return {
        deliveryId: delivery.id,
        notificationId: delivery.notificationId,
        channel: delivery.channel,
        status: finalDeliveryStatus,
        providerMessageId,
        errorCode,
        errorMessage,
        attemptCount: newAttemptCount,
    };
}

/**
 * Recomputes and updates parent Notification aggregate status based on all sibling delivery states.
 */
export async function aggregateParentNotificationStatus(
    prisma: PrismaClient | Prisma.TransactionClient,
    notificationId: string,
): Promise<NotificationStatus> {
    const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId },
    });

    if (deliveries.length === 0) {
        return NotificationStatus.PENDING;
    }

    // Check if any delivery is still in progress or waiting
    const hasInFlight = deliveries.some(
        (d) =>
            d.status === NotificationDeliveryStatus.PENDING ||
            d.status === NotificationDeliveryStatus.PROCESSING ||
            d.status === NotificationDeliveryStatus.PENDING_RETRY,
    );

    if (hasInFlight) {
        await prisma.notification.update({
            where: { id: notificationId },
            data: { status: NotificationStatus.PROCESSING },
        });
        return NotificationStatus.PROCESSING;
    }

    // All deliveries are in terminal states: DELIVERED, FAILED, EXHAUSTED, SKIPPED, SUPPRESSED
    const deliveredCount = deliveries.filter(
        (d) => d.status === NotificationDeliveryStatus.DELIVERED,
    ).length;

    const failedCount = deliveries.filter(
        (d) =>
            d.status === NotificationDeliveryStatus.FAILED ||
            d.status === NotificationDeliveryStatus.EXHAUSTED,
    ).length;

    const suppressedCount = deliveries.filter(
        (d) => d.status === NotificationDeliveryStatus.SUPPRESSED,
    ).length;

    let aggregatedStatus: NotificationStatus;

    if (suppressedCount === deliveries.length) {
        aggregatedStatus = NotificationStatus.SUPPRESSED;
    } else if (deliveredCount > 0 && failedCount === 0) {
        aggregatedStatus = NotificationStatus.SENT;
    } else if (deliveredCount > 0 && failedCount > 0) {
        aggregatedStatus = NotificationStatus.PARTIALLY_SENT;
    } else if (deliveredCount === 0 && failedCount > 0) {
        aggregatedStatus = NotificationStatus.FAILED;
    } else {
        // If all deliveries were SKIPPED
        aggregatedStatus = NotificationStatus.SENT;
    }

    await prisma.notification.update({
        where: { id: notificationId },
        data: { status: aggregatedStatus },
    });

    return aggregatedStatus;
}
