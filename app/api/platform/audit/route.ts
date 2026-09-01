import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { queryPlatformAuditLog } from "@/lib/services/platform/audit";

/**
 * GET /api/platform/audit
 * Queries the append-only platform audit log ledger with filtering and pagination.
 * Gated by: platform.audit.view
 */
export const GET = withPlatformAuth(
    async (req: NextRequest, context) => {
        const searchParams = req.nextUrl.searchParams;

        const action = searchParams.get("action") || undefined;
        const actorUserId = searchParams.get("actorUserId") || undefined;
        const targetType = (searchParams.get("targetType") as any) || undefined;
        const targetId = searchParams.get("targetId") || undefined;
        const workspaceId = searchParams.get("workspaceId") || undefined;
        const limitParam = searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        const offsetParam = searchParams.get("offset");
        const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;
        const startDateParam = searchParams.get("startDate");
        const startDate = startDateParam ? new Date(startDateParam) : undefined;
        const endDateParam = searchParams.get("endDate");
        const endDate = endDateParam ? new Date(endDateParam) : undefined;

        const result = await queryPlatformAuditLog(context, {
            action,
            actorUserId,
            targetType,
            targetId,
            workspaceId,
            limit,
            offset,
            startDate,
            endDate,
        });

        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.AUDIT_VIEW,
    }
);
