import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { toggleFeatureFlag } from "@/lib/services/platform/flags";

interface FlagRouteParams {
    flagId: string;
}

/**
 * POST /api/platform/flags/[flagId]/toggle
 * Toggles a feature flag on or off (Tier-1 Mutating Action).
 * Gated by: platform.config.manage_flags
 */
export const POST = withPlatformAuth<FlagRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json();
        const enabled = Boolean(body.enabled);
        const reason = body.reason || "";

        const updated = await toggleFeatureFlag(
            context,
            params.flagId,
            enabled,
            reason
        );
        return jsonSuccess(updated);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS,
    }
);
