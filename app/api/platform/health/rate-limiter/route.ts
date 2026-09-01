import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { getPlatformRateLimiterBlockerStatus } from "@/lib/services/platform/health";

/**
 * GET /api/platform/health/rate-limiter
 * Surfaces Phase 1.18 in-memory sliding window rate limiter blocker and multi-instance risk.
 * Gated by: platform.config.view
 */
export const GET = withPlatformAuth(
    async (_req, context) => {
        const blocker = await getPlatformRateLimiterBlockerStatus(context);
        return jsonSuccess(blocker);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_VIEW,
    }
);
