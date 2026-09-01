import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { replayPlatformBillingWebhook } from "@/lib/services/platform/billing";

interface WebhookRouteParams {
    eventId: string;
}

/**
 * POST /api/platform/billing/webhooks/[eventId]/replay
 * Manually re-dispatches/replays a failed billing webhook (Tier-1 Operational Action).
 * Gated by: platform.billing.sync_gateway
 */
export const POST = withPlatformAuth<WebhookRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason || "";

        const result = await replayPlatformBillingWebhook(
            context,
            params.eventId,
            reason
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.BILLING_SYNC_GATEWAY,
    }
);
