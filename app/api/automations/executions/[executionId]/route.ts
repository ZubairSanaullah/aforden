import { NextResponse } from "next/server";
import { getAutomationExecution } from "@/lib/services/automation";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
  resolveWorkspaceId,
  handleAutomationApiError,
} from "@/lib/utils/automationApiError";

interface RouteContext {
  params: Promise<{
    executionId: string;
  }>;
}

/**
 * GET /api/automations/executions/[executionId]
 *
 * Retrieves detailed execution trace including all sequential steps.
 * Permissions: AUTOMATIONS_VIEW (OWNER, ADMIN, MANAGER).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { executionId } = await context.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);
    const execution = await getAutomationExecution(workspaceId, executionId, auth);

    return NextResponse.json(
      {
        success: true,
        data: execution,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "GET /api/automations/executions/[executionId]");
  }
}
