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
 * GET /api/integrations/[integrationId]/executions
 *
 * Lists paginated execution audit ledger history with sanitized payload snapshots.
 * RBAC: integration.view_history (OWNER, ADMIN, MANAGER).
 */
export async function GET(
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
      PERMISSIONS.INTEGRATIONS_VIEW_HISTORY
    );

    const url = new URL(request.url);
    const searchParams = url.searchParams;

    const query = {
      page: searchParams.has("page") ? parseInt(searchParams.get("page")!, 10) : 1,
      pageSize: searchParams.has("pageSize") ? parseInt(searchParams.get("pageSize")!, 10) : 20,
      status: searchParams.get("status") ?? undefined,
      capability: searchParams.get("capability") ?? undefined,
      sortBy: (searchParams.get("sortBy") as any) ?? "createdAt",
      sortOrder: (searchParams.get("sortOrder") as any) ?? "desc",
    };

    const result = await IntegrationManagementService.listIntegrationExecutions(
      workspaceId,
      integrationId,
      query
    );

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleIntegrationApiError(error, "GET /api/integrations/[integrationId]/executions");
  }
}
