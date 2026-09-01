import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";

/**
 * GET /api/platform/me
 * Returns the authenticated platform operator profile context.
 */
export const GET = withPlatformAuth(async (_req, context) => {
    return jsonSuccess(context);
});
