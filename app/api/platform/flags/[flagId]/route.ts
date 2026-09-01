import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import {
    updateFeatureFlag,
    deleteFeatureFlag,
} from "@/lib/services/platform/flags";

interface FlagRouteParams {
    flagId: string;
}

/**
 * PATCH /api/platform/flags/[flagId]
 * Updates feature flag definition and rollout settings (Tier-1 Mutating Action).
 * Gated by: platform.config.manage_flags
 */
export const PATCH = withPlatformAuth<FlagRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json();
        const reason = body.reason || "";
        const updated = await updateFeatureFlag(
            context,
            params.flagId,
            body,
            reason
        );
        return jsonSuccess(updated);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS,
    }
);

/**
 * DELETE /api/platform/flags/[flagId]
 * Permanently deletes a platform feature flag (Tier-2 Mutating Action).
 * Gated by: platform.config.manage_flags
 */
export const DELETE = withPlatformAuth<FlagRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason || "";
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const result = await deleteFeatureFlag(
            context,
            params.flagId,
            reason,
            options
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS,
    }
);
