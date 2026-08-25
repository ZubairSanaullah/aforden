import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { getUnreadNotificationCount } from "@/lib/services/notification";
import { handleNotificationApiError } from "@/lib/utils/notificationApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/notifications/unread-count
 * Returns the unread, non-archived notification count for the authenticated workspace member.
 */
export async function GET(_request: Request, context: RouteContext) {
    try {
        const { workspaceId } = await context.params;
        const { membership } = await requireWorkspaceAuthorization(workspaceId);

        const count = await getUnreadNotificationCount(
            prisma,
            workspaceId,
            membership.id,
        );

        return NextResponse.json(
            {
                success: true,
                data: {
                    count,
                },
            },
            { status: 200 },
        );
    } catch (error) {
        return handleNotificationApiError(error, "GET /notifications/unread-count");
    }
}
