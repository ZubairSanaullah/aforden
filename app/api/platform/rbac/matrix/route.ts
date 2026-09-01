import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import {
    PLATFORM_PERMISSIONS,
    PLATFORM_ROLE_PERMISSIONS,
} from "@/lib/services/platform/authorization";

/**
 * GET /api/platform/rbac/matrix
 * Returns the platform role-to-permissions capability matrix for administrative inspection.
 * Gated by: platform.operators.view
 */
export const GET = withPlatformAuth(
    async () => {
        return jsonSuccess({
            matrix: PLATFORM_ROLE_PERMISSIONS,
        });
    },
    {
        permission: PLATFORM_PERMISSIONS.OPERATORS_VIEW,
    }
);
