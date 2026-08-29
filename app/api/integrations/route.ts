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
 * GET /api/integrations
 *
 * Lists all catalog integrations merged with workspace connection status.
 * RBAC: integration.view_status (OWNER, ADMIN, MANAGER, DISPATCHER).
 */
export async function GET(request: Request) {
  try {
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);
    await requirePermission(
      auth.user.id,
      workspaceId,
      PERMISSIONS.INTEGRATIONS_VIEW_STATUS
    );

    const result = await IntegrationManagementService.listIntegrationsWithStatus(workspaceId);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleIntegrationApiError(error, "GET /api/integrations");
  }
}
