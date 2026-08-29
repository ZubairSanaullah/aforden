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
 * POST /api/integrations/[integrationId]/test
 *
 * Runs health check against provider connection.
 * RBAC: integration.manage_connection (OWNER, ADMIN).
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
    await requirePermission(
      auth.user.id,
      workspaceId,
      PERMISSIONS.INTEGRATIONS_MANAGE_CONNECTION
    );

    const result = await IntegrationManagementService.testIntegrationConnection(
      workspaceId,
      integrationId
    );

    return NextResponse.json(
      {
        success: result.success,
        data: result,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleIntegrationApiError(error, "POST /api/integrations/[integrationId]/test");
  }
}
