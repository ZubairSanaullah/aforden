import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { removePlatformWorkspaceEntitlementOverride } from "@/lib/services/platform/billing";

interface EntitlementRouteParams {
    workspaceId: string;
    featureKey: string;
}

/**
 * DELETE /api/platform/billing/workspaces/[workspaceId]/entitlements/[featureKey]
 * Revokes a custom feature entitlement override (Tier-2 Mutating Action).
 * Gated by: platform.billing.override_entitlements
 */
export const DELETE = withPlatformAuth<EntitlementRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason || "";
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const result = await removePlatformWorkspaceEntitlementOverride(
            context,
            params.workspaceId,
            params.featureKey,
            reason,
            options
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.BILLING_OVERRIDE_ENTITLEMENTS,
    }
);
