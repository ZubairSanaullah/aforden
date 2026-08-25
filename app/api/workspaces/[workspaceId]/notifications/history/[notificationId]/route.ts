import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { MembershipRole } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { getNotificationDetails } from "@/lib/services/notification/notificationHistoryService";
import { handleNotificationApiError } from "@/lib/utils/notificationApiError";

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ workspaceId: string; notificationId: string }> },
) {
    try {
        const { workspaceId, notificationId } = await context.params;
        const authorization = await requireWorkspaceAuthorization(workspaceId);

        const allowedRoles: MembershipRole[] = [
            MembershipRole.OWNER,
            MembershipRole.ADMIN,
            MembershipRole.MANAGER,
            MembershipRole.DISPATCHER,
            MembershipRole.ACCOUNTANT,
        ];

        if (!allowedRoles.includes(authorization.membership.role)) {
            throw new ForbiddenError(
                "You do not have permission to view notification details.",
            );
        }

        const notification = await getNotificationDetails(
            prisma,
            workspaceId,
            notificationId,
        );

        return NextResponse.json({
            success: true,
            data: notification,
        });
    } catch (error) {
        return handleNotificationApiError(error, "GET /api/workspaces/[workspaceId]/notifications/history/[notificationId]");
    }
}
