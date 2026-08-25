import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
    listInAppNotifications,
    queryNotificationFeedSchema,
} from "@/lib/services/notification";
import {
    handleNotificationApiError,
    extractQueryParams,
} from "@/lib/utils/notificationApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/notifications
 * Lists paginated, filtered in-app notifications for the authenticated workspace member.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId } = await context.params;
        const { membership } = await requireWorkspaceAuthorization(workspaceId);

        const rawQuery = extractQueryParams(request);
        const parsedQuery = queryNotificationFeedSchema.parse(rawQuery);

        const offset =
            parsedQuery.offset ??
            (parsedQuery.page ? (parsedQuery.page - 1) * parsedQuery.limit : 0);

        const result = await listInAppNotifications(
            prisma,
            workspaceId,
            membership.id,
            {
                workspaceId,
                memberId: membership.id,
                isRead: parsedQuery.isRead,
                isArchived: parsedQuery.isArchived,
                limit: parsedQuery.limit,
                offset,
            },
        );

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleNotificationApiError(error, "GET /notifications");
    }
}
