import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { revokePlatformIntegrationCredential } from "@/lib/services/platform/integrations";

interface CredentialRouteParams {
    credentialId: string;
}

/**
 * POST /api/platform/integrations/credentials/[credentialId]/revoke
 * Revokes a stored OAuth/API credential for an integration (Tier-2 Mutating Action).
 * Gated by: platform.integrations.revoke_credentials
 */
export const POST = withPlatformAuth<CredentialRouteParams>(
    async (req: NextRequest, context, params) => {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason || "";
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const result = await revokePlatformIntegrationCredential(
            context,
            params.credentialId,
            reason,
            options
        );
        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.INTEGRATIONS_REVOKE_CREDENTIALS,
    }
);
