import { NextResponse } from "next/server";
import { replayDeadLetterExecution } from "@/lib/services/automation";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
  resolveWorkspaceId,
  handleAutomationApiError,
} from "@/lib/utils/automationApiError";

/**
 * POST /api/automations/dlq/[executionId]/replay
 *
 * Replays a failed Dead Letter Queue execution through the automation pipeline.
 * Permissions: AUTOMATIONS_MANAGE (OWNER, ADMIN).
 */
export async function POST(
  request: Request,
  props: { params: Promise<{ executionId: string }> },
) {
  try {
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);
    const { executionId } = await props.params;

    const result = await replayDeadLetterExecution(
      workspaceId,
      executionId,
      auth,
    );

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(
      error,
      "POST /api/automations/dlq/[executionId]/replay",
    );
  }
}
