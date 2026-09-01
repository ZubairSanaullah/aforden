import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { listPlatformIntegrations } from "@/lib/services/platform/integrations";

/**
 * GET /api/platform/integrations
 * Lists system integrations and third-party connector definitions.
 * Gated by: platform.config.view
 */
export const GET = withPlatformAuth(
    async (_req, context) => {
        const integrations = await listPlatformIntegrations(context);
        return jsonSuccess(integrations);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_VIEW,
    }
);
