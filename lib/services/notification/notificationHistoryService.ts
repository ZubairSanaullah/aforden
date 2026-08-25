/**
 * Phase 1.13.10 — Notification History & Audit Services
 * Provides tenant-isolated query services for workspace notification records,
 * delivery breakdowns, and durable provider attempt logs.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    NotificationEventType,
    NotificationStatus,
    NotificationChannel,
    NotificationDeliveryStatus,
} from "@/generated/prisma/enums";
import {
    NotificationNotFoundError,
    NotificationDeliveryNotFoundError,
    NotificationCrossTenantLeakageError,
} from "./notificationErrors";

export interface ListNotificationHistoryFilters {
    eventType?: NotificationEventType;
    status?: NotificationStatus;
    channel?: NotificationChannel;
    sourceEntity?: string;
    sourceId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
    page?: number;
}

export interface PaginatedNotificationHistoryResult {
    items: any[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

/**
 * Lists notifications in a workspace with filtering and pagination.
 */
export async function listNotificationHistory(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    filters: ListNotificationHistoryFilters = {},
): Promise<PaginatedNotificationHistoryResult> {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError("workspaceId is required.");
    }

    const limit = Math.min(100, Math.max(1, filters.limit || 20));
    const page = Math.max(1, filters.page || 1);
    const offset = filters.offset !== undefined ? filters.offset : (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = {
        workspaceId,
        ...(filters.eventType ? { eventType: filters.eventType } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.sourceEntity ? { sourceEntity: filters.sourceEntity } : {}),
        ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
        ...(filters.channel ? { deliveries: { some: { channel: filters.channel } } } : {}),
        ...(filters.startDate || filters.endDate
            ? {
                  createdAt: {
                      ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
                      ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
                  },
              }
            : {}),
    };

    const [total, items] = await Promise.all([
        prisma.notification.count({ where }),
        prisma.notification.findMany({
            where,
            include: {
                deliveries: {
                    select: {
                        id: true,
                        channel: true,
                        status: true,
                        recipientType: true,
                        destination: true,
                        attemptCount: true,
                        deliveredAt: true,
                        nextAttemptAt: true,
                        errorCode: true,
                        errorMessage: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
            skip: offset,
            take: limit,
        }),
    ]);

    return {
        items,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
        },
    };
}

/**
 * Retrieves full details of a specific Notification including all deliveries and logs.
 */
export async function getNotificationDetails(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    notificationId: string,
) {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError("workspaceId is required.");
    }

    const notification = await prisma.notification.findFirst({
        where: {
            id: notificationId,
            workspaceId,
        },
        include: {
            deliveries: {
                include: {
                    logs: {
                        orderBy: { attemptNumber: "asc" },
                    },
                },
            },
            logs: {
                orderBy: { createdAt: "asc" },
            },
        },
    });

    if (!notification) {
        throw new NotificationNotFoundError(
            `Notification ${notificationId} not found in workspace ${workspaceId}.`,
        );
    }

    return notification;
}

/**
 * Retrieves audit attempt logs for a specific NotificationDelivery record.
 */
export async function getDeliveryLogs(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    deliveryId: string,
) {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError("workspaceId is required.");
    }

    const delivery = await prisma.notificationDelivery.findFirst({
        where: {
            id: deliveryId,
            workspaceId,
        },
    });

    if (!delivery) {
        throw new NotificationDeliveryNotFoundError(
            `NotificationDelivery ${deliveryId} not found in workspace ${workspaceId}.`,
        );
    }

    return await prisma.notificationLog.findMany({
        where: {
            workspaceId,
            deliveryId,
        },
        orderBy: { attemptNumber: "asc" },
    });
}
