import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { changePlatformRole } from "@/lib/services/platform/operators";

interface OperatorRouteParams {
    operatorId: string;
}

/**
 * PATCH /api/platform/operators/[operatorId]/role
 * Updates a platform operator's role assignment (Tier-2 Mutating Action).
 * Gated by: platform.operators.update_role
 */
export const PATCH = withPlatformAuth<OperatorRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json();
        const role = body.role;
        const reason = body.reason || "";
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const updated = await changePlatformRole(
            context,
            params.operatorId,
            role,
            reason,
            options
        );
        return jsonSuccess(updated);
    },
    {
        permission: PLATFORM_PERMISSIONS.OPERATORS_UPDATE_ROLE,
    }
);
