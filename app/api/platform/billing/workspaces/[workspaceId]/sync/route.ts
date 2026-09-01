import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { syncPlatformBillingAccount } from "@/lib/services/platform/billing";

interface WorkspaceRouteParams {
    workspaceId: string;
}

/**
 * POST /api/platform/billing/workspaces/[workspaceId]/sync
 * Re-synchronizes billing state with payment gateway (Tier-1 Operational Action).
 * Gated by: platform.billing.sync_gateway
 */
export const POST = withPlatformAuth<WorkspaceRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason || "";

        const result = await syncPlatformBillingAccount(
            context,
            params.workspaceId,
            reason
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.BILLING_SYNC_GATEWAY,
    }
);
