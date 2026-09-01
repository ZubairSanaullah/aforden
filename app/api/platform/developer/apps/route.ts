import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { listPlatformDeveloperApplications } from "@/lib/services/platform/developer";

/**
 * GET /api/platform/developer/apps
 * Lists registered developer applications with status and workspace filtering.
 * Gated by: platform.developer.view_apps
 */
export const GET = withPlatformAuth(
    async (req: NextRequest, context) => {
        const searchParams = req.nextUrl.searchParams;

        const workspaceId = searchParams.get("workspaceId") || undefined;
        const status = (searchParams.get("status") as any) || undefined;
        const search = searchParams.get("search") || undefined;
        const limitParam = searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        const offsetParam = searchParams.get("offset");
        const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

        const result = await listPlatformDeveloperApplications(context, {
            workspaceId,
            status,
            search,
            limit,
            offset,
        });

        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.DEVELOPER_VIEW_APPS,
    }
);
