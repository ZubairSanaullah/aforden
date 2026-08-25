/**
 * Phase 1.13.8 — In-App Notification Center & Member Feed Service
 * Provides query, unread count, read-state transitions, and archival for member-scoped in-app feeds.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    InAppNotificationFeedItemDTO,
    NotificationFeedQueryInput,
} from "./notification.types";
import {
    NotificationCrossTenantLeakageError,
    NotificationNotFoundError,
} from "./notificationErrors";

export interface NotificationFeedResult {
    items: InAppNotificationFeedItemDTO[];
    total: number;
    hasMore: boolean;
}

function mapFeedItemToDTO(item: {
    id: string;
    workspaceId: string;
    memberId: string;
    notificationId: string;
    title: string;
    body: string;
    linkUrl: string | null;
    sourceEntity: string | null;
    sourceId: string | null;
    isRead: boolean;
    readAt: Date | null;
    isArchived: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}): InAppNotificationFeedItemDTO {
    return {
        id: item.id,
        workspaceId: item.workspaceId,
        memberId: item.memberId,
        notificationId: item.notificationId,
        title: item.title,
        body: item.body,
        linkUrl: item.linkUrl,
        sourceEntity: item.sourceEntity,
        sourceId: item.sourceId,
        isRead: item.isRead,
        readAt: item.readAt ? item.readAt.toISOString() : null,
        isArchived: item.isArchived,
        archivedAt: item.archivedAt ? item.archivedAt.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
    };
}

/**
 * Lists paginated in-app notifications for the authenticated workspace member.
 * Strictly filters by both workspaceId AND memberId.
 */
export async function listInAppNotifications(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    memberId: string,
    query: NotificationFeedQueryInput = { workspaceId: "", memberId: "" },
): Promise<NotificationFeedResult> {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId is required to list in-app notifications.",
        );
    }
    if (!memberId) {
        throw new NotificationCrossTenantLeakageError(
            "memberId is required to list in-app notifications.",
        );
    }

    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);

    const where: Prisma.InAppNotificationFeedWhereInput = {
        workspaceId,
        memberId,
        ...(query.isRead !== undefined ? { isRead: query.isRead } : {}),
        isArchived: query.isArchived !== undefined ? query.isArchived : false,
    };

    const [total, items] = await Promise.all([
        prisma.inAppNotificationFeed.count({ where }),
        prisma.inAppNotificationFeed.findMany({
            where,
            skip: offset,
            take: limit,
            orderBy: { createdAt: "desc" },
        }),
    ]);

    return {
        items: items.map(mapFeedItemToDTO),
        total,
        hasMore: offset + items.length < total,
    };
}

/**
 * Returns the count of unread, non-archived in-app notifications for the workspace member.
 */
export async function getUnreadNotificationCount(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    memberId: string,
): Promise<number> {
    if (!workspaceId || !memberId) {
        return 0;
    }

    return await prisma.inAppNotificationFeed.count({
        where: {
            workspaceId,
            memberId,
            isRead: false,
            isArchived: false,
        },
    });
}

/**
 * Marks a single in-app notification feed item as read.
 * Enforces ownership: verifies the feed item belongs to (workspaceId, memberId).
 */
export async function markNotificationAsRead(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    memberId: string,
    feedItemId: string,
): Promise<InAppNotificationFeedItemDTO> {
    if (!workspaceId || !memberId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId and memberId are required.",
        );
    }

    const item = await prisma.inAppNotificationFeed.findFirst({
        where: {
            id: feedItemId,
            workspaceId,
            memberId,
        },
    });

    if (!item) {
        throw new NotificationNotFoundError(
            `In-app notification ${feedItemId} not found for this member.`,
        );
    }

    if (item.isRead) {
        return mapFeedItemToDTO(item);
    }

    const updated = await prisma.inAppNotificationFeed.update({
        where: { id: item.id },
        data: {
            isRead: true,
            readAt: new Date(),
        },
    });

    return mapFeedItemToDTO(updated);
}

/**
 * Marks all unread, non-archived in-app notifications as read for the member.
 */
export async function markAllNotificationsAsRead(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    memberId: string,
): Promise<{ updatedCount: number }> {
    if (!workspaceId || !memberId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId and memberId are required.",
        );
    }

    const result = await prisma.inAppNotificationFeed.updateMany({
        where: {
            workspaceId,
            memberId,
            isRead: false,
            isArchived: false,
        },
        data: {
            isRead: true,
            readAt: new Date(),
        },
    });

    return { updatedCount: result.count };
}

/**
 * Archives a single in-app notification feed item.
 * Enforces ownership: verifies the feed item belongs to (workspaceId, memberId).
 */
export async function archiveNotification(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    memberId: string,
    feedItemId: string,
): Promise<InAppNotificationFeedItemDTO> {
    if (!workspaceId || !memberId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId and memberId are required.",
        );
    }

    const item = await prisma.inAppNotificationFeed.findFirst({
        where: {
            id: feedItemId,
            workspaceId,
            memberId,
        },
    });

    if (!item) {
        throw new NotificationNotFoundError(
            `In-app notification ${feedItemId} not found for this member.`,
        );
    }

    if (item.isArchived) {
        return mapFeedItemToDTO(item);
    }

    const updated = await prisma.inAppNotificationFeed.update({
        where: { id: item.id },
        data: {
            isArchived: true,
            archivedAt: new Date(),
        },
    });

    return mapFeedItemToDTO(updated);
}
