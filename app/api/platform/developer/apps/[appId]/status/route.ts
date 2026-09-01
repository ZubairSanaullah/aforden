import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { updatePlatformDeveloperApplicationStatus } from "@/lib/services/platform/developer";

interface AppRouteParams {
    appId: string;
}

/**
 * PATCH /api/platform/developer/apps/[appId]/status
 * Suspends or activates a developer application (Tier-2 Mutating Action).
 * Gated by: platform.developer.revoke_keys
 */
export const PATCH = withPlatformAuth<AppRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json();
        const status = body.status;
        const reason = body.reason || "";
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const result = await updatePlatformDeveloperApplicationStatus(
            context,
            params.appId,
            status,
            reason,
            options
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.DEVELOPER_REVOKE_KEYS,
    }
);
