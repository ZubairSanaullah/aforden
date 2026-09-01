import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { getPlatformQueueHealth } from "@/lib/services/platform/health";

/**
 * GET /api/platform/health/queues
 * Inspects asynchronous job queue depths, outbox backlogs, and failure metrics.
 * Gated by: platform.operations.view_queues
 */
export const GET = withPlatformAuth(
    async (_req, context) => {
        const queueHealth = await getPlatformQueueHealth(context);
        return jsonSuccess(queueHealth);
    },
    {
        permission: PLATFORM_PERMISSIONS.OPERATIONS_VIEW_QUEUES,
    }
);
