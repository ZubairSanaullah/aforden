import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { revokePlatformApiKey } from "@/lib/services/platform/developer";

interface KeyRouteParams {
    keyId: string;
}

/**
 * POST /api/platform/developer/keys/[keyId]/revoke
 * Revokes a public API key credential (Tier-2 Mutating Action).
 * Gated by: platform.developer.revoke_keys
 */
export const POST = withPlatformAuth<KeyRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason || "";
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const result = await revokePlatformApiKey(
            context,
            params.keyId,
            reason,
            options
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.DEVELOPER_REVOKE_KEYS,
    }
);
