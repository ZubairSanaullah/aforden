import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { resetPlatformRateLimit } from "@/lib/services/platform/developer";

/**
 * POST /api/platform/developer/rate-limits/reset
 * Resets a rate limit counter for an IP, Key, or Workspace (Tier-1 Mutating Action).
 * Gated by: platform.developer.manage_webhooks
 */
export const POST = withPlatformAuth(
    async (req: NextRequest, context) => {
        const body = await req.json();
        const reason = body.reason || "";
        const target = {
            key: body.key,
            targetType: body.targetType,
            workspaceId: body.workspaceId,
        };

        const result = await resetPlatformRateLimit(context, target, reason);
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.DEVELOPER_MANAGE_WEBHOOKS,
    }
);
