import { NextResponse } from "next/server";
import { listDeadLetterExecutions } from "@/lib/services/automation";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
  resolveWorkspaceId,
  handleAutomationApiError,
} from "@/lib/utils/automationApiError";

/**
 * GET /api/automations/dlq
 *
 * Lists Dead Letter Queue executions for a workspace with tenant isolation.
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
      search: searchParams.get("search") ?? undefined,
      reasonCode: searchParams.get("reasonCode") ?? undefined,
      page: searchParams.has("page") ? parseInt(searchParams.get("page")!, 10) : 1,
      pageSize: searchParams.has("pageSize") ? parseInt(searchParams.get("pageSize")!, 10) : 20,
    };

    const result = await listDeadLetterExecutions(workspaceId, query, auth);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "GET /api/automations/dlq");
  }
}
