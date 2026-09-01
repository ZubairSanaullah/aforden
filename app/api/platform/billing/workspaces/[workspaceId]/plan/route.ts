import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { assignPlatformSubscriptionPlan } from "@/lib/services/platform/billing";

interface WorkspaceRouteParams {
    workspaceId: string;
}

/**
 * POST /api/platform/billing/workspaces/[workspaceId]/plan
 * Manually assigns/upgrades a subscription plan for a workspace (Tier-2 Mutating Action).
 * Gated by: platform.billing.manage_plans
 */
export const POST = withPlatformAuth<WorkspaceRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json();
        const planId = body.planId;
        const reason = body.reason || "";
        const options = {
            seatsCount: body.seatsCount,
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const result = await assignPlatformSubscriptionPlan(
            context,
            params.workspaceId,
            planId,
            reason,
            options
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.BILLING_MANAGE_PLANS,
    }
);
