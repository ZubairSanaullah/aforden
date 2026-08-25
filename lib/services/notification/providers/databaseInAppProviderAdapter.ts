/**
 * Phase 1.13.7 — Database In-App Feed Notification Provider Adapter
 * Writes notifications directly into the workspace member's in-app feed.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    InAppProvider,
    PublishInAppInput,
    PublishInAppResult,
} from "./provider.types";
import {
    NotificationCrossTenantLeakageError,
    NotificationRecipientUnresolvableError,
} from "../notificationErrors";

export class DatabaseInAppProviderAdapter implements InAppProvider {
    public readonly name = "DATABASE_IN_APP";

    async publishInApp(
        prisma: PrismaClient | Prisma.TransactionClient,
        input: PublishInAppInput,
    ): Promise<PublishInAppResult> {
        if (!input.workspaceId) {
            throw new NotificationCrossTenantLeakageError(
                "workspaceId is required to publish in-app notification.",
            );
        }

        if (!input.memberId) {
            throw new NotificationRecipientUnresolvableError(
                "memberId is required for in-app notification delivery.",
            );
        }

        const feedItem = await prisma.inAppNotificationFeed.create({
            data: {
                workspaceId: input.workspaceId,
                memberId: input.memberId,
                notificationId: input.notificationId,
                title: input.title,
                body: input.body,
                linkUrl: input.linkUrl || null,
                sourceEntity: input.sourceEntity || null,
                sourceId: input.sourceId || null,
                isRead: false,
                isArchived: false,
            },
        });

        return {
            success: true,
            feedItemId: feedItem.id,
        };
    }
}
