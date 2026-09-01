import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { listSettings } from "@/lib/services/platform/settings";

/**
 * GET /api/platform/settings
 * Lists all active platform operational runtime configuration overrides.
 * Gated by: platform.config.view
 */
export const GET = withPlatformAuth(
    async (_req, context) => {
        const settings = await listSettings(context);
        return jsonSuccess(settings);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_VIEW,
    }
);
