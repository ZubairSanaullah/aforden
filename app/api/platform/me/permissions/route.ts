import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_ROLE_PERMISSIONS } from "@/lib/services/platform/authorization";

/**
 * GET /api/platform/me/permissions
 * Returns the effective platform permissions assigned to the caller's platform role.
 */
export const GET = withPlatformAuth(async (_req, context) => {
    const permissions = PLATFORM_ROLE_PERMISSIONS[context.platformRole] || [];
    return jsonSuccess({
        role: context.platformRole,
        permissions,
    });
});
