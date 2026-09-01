import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { testPlatformIntegrationConnection } from "@/lib/services/platform/integrations";

interface ConnectionRouteParams {
    connectionId: string;
}

/**
 * POST /api/platform/integrations/connections/[connectionId]/test
 * Tests connectivity and heartbeat for an integration connection (Tier-1 Operational Action).
 * Gated by: platform.config.update_settings
 */
export const POST = withPlatformAuth<ConnectionRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason || "";

        const result = await testPlatformIntegrationConnection(
            context,
            params.connectionId,
            reason
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_UPDATE_SETTINGS,
    }
);
