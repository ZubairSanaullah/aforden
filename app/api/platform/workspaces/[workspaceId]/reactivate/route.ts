import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { reactivateWorkspace } from "@/lib/services/platform/workspaces";

interface WorkspaceRouteParams {
    workspaceId: string;
}

/**
 * POST /api/platform/workspaces/[workspaceId]/reactivate
 * Reactivates a suspended workspace (Tier-2 Mutating Action).
 * Gated by: platform.workspaces.suspend
 */
export const POST = withPlatformAuth<WorkspaceRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason || "";
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const result = await reactivateWorkspace(
            context,
            params.workspaceId,
            reason,
            options
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.WORKSPACES_SUSPEND,
    }
);
