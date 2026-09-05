import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { MembershipRole } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { getDeliveryLogs } from "@/lib/services/notification/notificationHistoryService";
import { handleNotificationApiError } from "@/lib/utils/notificationApiError";

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ workspaceId: string; deliveryId: string }> },
) {
    try {
        const { workspaceId, deliveryId } = await context.params;
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
                "You do not have permission to view delivery logs.",
            );
        }

        const logs = await getDeliveryLogs(prisma, workspaceId, deliveryId);

        return NextResponse.json({
            success: true,
            data: logs,
        });
    } catch (error) {
        return handleNotificationApiError(error, "GET /api/workspaces/[workspaceId]/notifications/deliveries/[deliveryId]/logs");
    }
}
