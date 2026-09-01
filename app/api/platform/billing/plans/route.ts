import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { listPlatformSubscriptionPlans } from "@/lib/services/platform/billing";

/**
 * GET /api/platform/billing/plans
 * Lists available subscription plans, tier pricing, and feature quotas.
 * Gated by: platform.billing.view
 */
export const GET = withPlatformAuth(
    async (_req, context) => {
        const plans = await listPlatformSubscriptionPlans(context);
        return jsonSuccess(plans);
    },
    {
        permission: PLATFORM_PERMISSIONS.BILLING_VIEW,
    }
);
