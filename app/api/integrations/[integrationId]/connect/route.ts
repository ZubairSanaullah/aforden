import { NextResponse } from "next/server";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { requirePermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  resolveWorkspaceId,
  handleIntegrationApiError,
} from "@/lib/utils/integrationApiError";
import { IntegrationManagementService } from "@/lib/integrations/api/integrationManagementService";

/**
 * POST /api/integrations/[integrationId]/connect
 *
 * Initiates OAuth2 handshake or validates & completes provider connection.
 * RBAC:
 * - integration.manage_connection for config updates & initiation
 * - integration.manage_credentials for credential-bearing payloads (API keys, secrets, OAuth codes)
 */
export async function POST(
  request: Request,
  props: { params: Promise<{ integrationId: string }> }
) {
  try {
    const { integrationId } = await props.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);

    // 1. Connection management permission is always required
    await requirePermission(
      auth.user.id,
      workspaceId,
      PERMISSIONS.INTEGRATIONS_MANAGE_CONNECTION
    );

    const body = await request.json().catch(() => ({}));

    // 2. Granular Credential RBAC: Check if payload carries secrets or credentials
    const carriesCredentials =
      Boolean(body.authPayload) ||
      Boolean(body.code) ||
      Boolean(body.apiKey || body.api_key) ||
      Boolean(body.authToken || body.auth_token) ||
      Boolean(body.clientSecret || body.client_secret) ||
      Boolean(body.secretAccessKey);

    if (carriesCredentials) {
      await requirePermission(
        auth.user.id,
        workspaceId,
        PERMISSIONS.INTEGRATIONS_MANAGE_CREDENTIALS
      );
    }

    const result = await IntegrationManagementService.connectIntegration(
      workspaceId,
      integrationId,
      body
    );

    return NextResponse.json(
      {
        success: result.success !== false,
        data: result,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleIntegrationApiError(error, "POST /api/integrations/[integrationId]/connect");
  }
}
