import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { upsertSetting } from "@/lib/services/platform/settings";

interface SettingRouteParams {
    key: string;
}

/**
 * PUT /api/platform/settings/[key]
 * Sets or updates a platform runtime setting override (Tier-1 Mutating Action).
 * Gated by: platform.config.update_settings
 */
export const PUT = withPlatformAuth<SettingRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json();
        const reason = body.reason || "";
        const input = {
            key: params.key,
            value: body.value,
            valueType: body.valueType || "STRING",
            description: body.description,
            isProtected: body.isProtected,
        };

        const result = await upsertSetting(
            context,
            input,
            reason
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_UPDATE_SETTINGS,
    }
);
