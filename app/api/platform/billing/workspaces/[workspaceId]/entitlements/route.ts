import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { overridePlatformWorkspaceEntitlement } from "@/lib/services/platform/billing";

interface WorkspaceRouteParams {
    workspaceId: string;
}

/**
 * POST /api/platform/billing/workspaces/[workspaceId]/entitlements
 * Grants custom feature entitlement overrides for a workspace (Tier-2 Mutating Action).
 * Gated by: platform.billing.override_entitlements
 */
export const POST = withPlatformAuth<WorkspaceRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json();
        const featureKey = body.featureKey;
        const value = body.value;
        const type = body.type;
        const reason = body.reason || "";
        const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const result = await overridePlatformWorkspaceEntitlement(
            context,
            params.workspaceId,
            featureKey,
            value,
            type,
            reason,
            expiresAt,
            options
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.BILLING_OVERRIDE_ENTITLEMENTS,
    }
);
