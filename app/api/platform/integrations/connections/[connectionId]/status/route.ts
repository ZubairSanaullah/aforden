import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { updatePlatformIntegrationConnectionStatus } from "@/lib/services/platform/integrations";

interface ConnectionRouteParams {
    connectionId: string;
}

/**
 * PATCH /api/platform/integrations/connections/[connectionId]/status
 * Suspends, revokes, or enables a tenant integration connection (Tier-2 Mutating Action).
 * Gated by: platform.config.update_settings
 */
export const PATCH = withPlatformAuth<ConnectionRouteParams>(
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

        const result = await updatePlatformIntegrationConnectionStatus(
            context,
            params.connectionId,
            status,
            reason,
            options
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_UPDATE_SETTINGS,
    }
);
