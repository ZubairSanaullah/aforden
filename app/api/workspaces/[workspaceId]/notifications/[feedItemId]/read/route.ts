import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { markNotificationAsRead } from "@/lib/services/notification";
import { handleNotificationApiError } from "@/lib/utils/notificationApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        feedItemId: string;
    }>;
}

/**
 * PATCH /api/workspaces/[workspaceId]/notifications/[feedItemId]/read
 * Marks a single in-app notification feed item as read.
 */
export async function PATCH(_request: Request, context: RouteContext) {
    try {
        const { workspaceId, feedItemId } = await context.params;
        const { membership } = await requireWorkspaceAuthorization(workspaceId);

        const item = await markNotificationAsRead(
            prisma,
            workspaceId,
            membership.id,
            feedItemId,
        );

        return NextResponse.json(
            {
                success: true,
                data: item,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleNotificationApiError(error, "PATCH /notifications/[feedItemId]/read");
    }
}
