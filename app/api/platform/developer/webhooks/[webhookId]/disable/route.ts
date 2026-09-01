import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { disablePlatformWebhookEndpoint } from "@/lib/services/platform/developer";

interface WebhookRouteParams {
    webhookId: string;
}

/**
 * POST /api/platform/developer/webhooks/[webhookId]/disable
 * Disables a failing developer webhook endpoint (Tier-1 Mutating Action).
 * Gated by: platform.developer.manage_webhooks
 */
export const POST = withPlatformAuth<WebhookRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason || "";

        const result = await disablePlatformWebhookEndpoint(
            context,
            params.webhookId,
            reason
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.DEVELOPER_MANAGE_WEBHOOKS,
    }
);
