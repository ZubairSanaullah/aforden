import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { getPlatformSystemHealthSummary } from "@/lib/services/platform/health";

/**
 * GET /api/platform/health
 * Master operational telemetry and system health rollup.
 * Gated by: platform.operations.view_queues
 */
export const GET = withPlatformAuth(
    async (_req, context) => {
        const summary = await getPlatformSystemHealthSummary(context);
        return jsonSuccess(summary);
    },
    {
        permission: PLATFORM_PERMISSIONS.OPERATIONS_VIEW_QUEUES,
    }
);
