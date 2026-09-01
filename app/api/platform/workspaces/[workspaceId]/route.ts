import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { getWorkspace } from "@/lib/services/platform/workspaces";

interface WorkspaceRouteParams {
    workspaceId: string;
}

/**
 * GET /api/platform/workspaces/[workspaceId]
 * Fetches workspace details and statistics.
 * Gated by: platform.workspaces.view
 */
export const GET = withPlatformAuth<WorkspaceRouteParams>(
    async (_req, context, params) => {
        const workspace = await getWorkspace(context, params.workspaceId);
        return jsonSuccess(workspace);
    },
    {
        permission: PLATFORM_PERMISSIONS.WORKSPACES_VIEW,
    }
);
