import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { markAllNotificationsAsRead } from "@/lib/services/notification";
import { handleNotificationApiError } from "@/lib/utils/notificationApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
    }>;
}

/**
 * POST /api/workspaces/[workspaceId]/notifications/read-all
 * Marks all unread, non-archived in-app notifications as read for the member.
 */
export async function POST(_request: Request, context: RouteContext) {
    try {
        const { workspaceId } = await context.params;
        const { membership } = await requireWorkspaceAuthorization(workspaceId);

        const result = await markAllNotificationsAsRead(
            prisma,
            workspaceId,
            membership.id,
        );

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleNotificationApiError(error, "POST /notifications/read-all");
    }
}
