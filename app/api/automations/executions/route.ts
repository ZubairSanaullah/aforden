import { NextResponse } from "next/server";
import { listAutomationExecutions } from "@/lib/services/automation";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
  resolveWorkspaceId,
  handleAutomationApiError,
} from "@/lib/utils/automationApiError";

/**
 * GET /api/automations/executions
 *
 * Lists automation execution history with filtering and pagination.
 * Permissions: AUTOMATIONS_VIEW (OWNER, ADMIN, MANAGER).
 */
export async function GET(request: Request) {
  try {
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);

    const url = new URL(request.url);
    const searchParams = url.searchParams;

    const query = {
      ruleId: searchParams.get("ruleId") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      fromDate: searchParams.get("fromDate") ?? undefined,
      toDate: searchParams.get("toDate") ?? undefined,
      page: searchParams.has("page") ? parseInt(searchParams.get("page")!, 10) : 1,
      pageSize: searchParams.has("pageSize") ? parseInt(searchParams.get("pageSize")!, 10) : 20,
      sortBy: (searchParams.get("sortBy") as any) ?? "createdAt",
      sortOrder: (searchParams.get("sortOrder") as any) ?? "desc",
    };

    const result = await listAutomationExecutions(workspaceId, query, auth);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "GET /api/automations/executions");
  }
}
