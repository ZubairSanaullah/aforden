import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { deactivatePlatformUser } from "@/lib/services/platform/operators";

interface OperatorRouteParams {
    operatorId: string;
}

/**
 * DELETE /api/platform/operators/[operatorId]
 * Deactivates a platform operator profile (Tier-2 Mutating Action).
 * Gated by: platform.operators.revoke
 */
export const DELETE = withPlatformAuth<OperatorRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason || "";
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const result = await deactivatePlatformUser(
            context,
            params.operatorId,
            reason,
            options
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.OPERATORS_REVOKE,
    }
);
