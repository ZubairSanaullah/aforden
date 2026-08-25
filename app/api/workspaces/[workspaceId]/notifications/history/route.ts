import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { MembershipRole } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { listNotificationHistory } from "@/lib/services/notification/notificationHistoryService";
import { queryNotificationHistorySchema } from "@/lib/services/notification/notification.schemas";
import { handleNotificationApiError } from "@/lib/utils/notificationApiError";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ workspaceId: string }> },
) {
    try {
        const { workspaceId } = await context.params;
        const authorization = await requireWorkspaceAuthorization(workspaceId);

        // RBAC: Only OWNER, ADMIN, MANAGER, DISPATCHER, ACCOUNTANT can view workspace-wide history
        const allowedRoles: MembershipRole[] = [
            MembershipRole.OWNER,
            MembershipRole.ADMIN,
            MembershipRole.MANAGER,
            MembershipRole.DISPATCHER,
            MembershipRole.ACCOUNTANT,
        ];

        if (!allowedRoles.includes(authorization.membership.role)) {
            throw new ForbiddenError(
                "You do not have permission to view workspace notification history.",
            );
        }

        const { searchParams } = new URL(request.url);
        const query = queryNotificationHistorySchema.parse({
            eventType: searchParams.get("eventType") || undefined,
            status: searchParams.get("status") || undefined,
            channel: searchParams.get("channel") || undefined,
            sourceEntity: searchParams.get("sourceEntity") || undefined,
            sourceId: searchParams.get("sourceId") || undefined,
            startDate: searchParams.get("startDate") || undefined,
            endDate: searchParams.get("endDate") || undefined,
            page: searchParams.get("page") || undefined,
            limit: searchParams.get("limit") || undefined,
            offset: searchParams.get("offset") || undefined,
        });

        const history = await listNotificationHistory(prisma, workspaceId, query);

        return NextResponse.json({
            success: true,
            data: history.items,
            pagination: history.pagination,
        });
    } catch (error) {
        return handleNotificationApiError(error, "GET /api/workspaces/[workspaceId]/notifications/history");
    }
}
