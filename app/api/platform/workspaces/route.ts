import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { getWorkspaces } from "@/lib/services/platform/workspaces";

/**
 * GET /api/platform/workspaces
 * Lists tenant workspaces with status, plan, and search filters.
 * Gated by: platform.workspaces.view
 */
export const GET = withPlatformAuth(
    async (req: NextRequest, context) => {
        const searchParams = req.nextUrl.searchParams;

        const search = searchParams.get("search") || undefined;
        const status = searchParams.get("status") || undefined;
        const planTier = searchParams.get("planTier") || undefined;
        const planCode = searchParams.get("planCode") || undefined;
        const subscriptionStatus = searchParams.get("subscriptionStatus") || undefined;
        const ownerUserId = searchParams.get("ownerUserId") || undefined;
        const ownerEmail = searchParams.get("ownerEmail") || undefined;
        const limitParam = searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        const offsetParam = searchParams.get("offset");
        const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

        const result = await getWorkspaces(context, {
            search,
            status,
            planTier,
            planCode,
            subscriptionStatus,
            ownerUserId,
            ownerEmail,
            limit,
            offset,
        });

        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
    }
);
