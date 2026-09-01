import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { getWorkspaceSupportDiagnostics } from "@/lib/services/platform/support";

interface WorkspaceRouteParams {
    workspaceId: string;
}

/**
 * GET /api/platform/workspaces/[workspaceId]/support
 * Reads tenant support diagnostic view (Audited Read Action).
 * Gated by: platform.workspaces.support_view
 */
export const GET = withPlatformAuth<WorkspaceRouteParams>(
    async (req: NextRequest, context, params) => {
        const ticketReference = req.nextUrl.searchParams.get("ticketReference") || undefined;
        const options = {
            ticketReference,
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
        };

        const view = await getWorkspaceSupportDiagnostics(
            context,
            params.workspaceId,
            options
        );
        return jsonSuccess(view);
    },
    {
        permission: PLATFORM_PERMISSIONS.WORKSPACES_SUPPORT_VIEW,
    }
);
