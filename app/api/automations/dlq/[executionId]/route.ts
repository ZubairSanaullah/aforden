import { NextResponse } from "next/server";
import {
  getDeadLetterExecution,
  purgeDeadLetterExecution,
} from "@/lib/services/automation";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
  resolveWorkspaceId,
  handleAutomationApiError,
} from "@/lib/utils/automationApiError";

/**
 * GET /api/automations/dlq/[executionId]
 *
 * Retrieves detailed failure diagnostics and step history for a single DLQ execution.
 * Permissions: AUTOMATIONS_VIEW (OWNER, ADMIN, MANAGER).
 */
export async function GET(
  request: Request,
  props: { params: Promise<{ executionId: string }> },
) {
  try {
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);
    const { executionId } = await props.params;

    const result = await getDeadLetterExecution(workspaceId, executionId, auth);

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
      "GET /api/automations/dlq/[executionId]",
    );
  }
}

/**
 * DELETE /api/automations/dlq/[executionId]
 *
 * Purges / marks a DLQ execution as resolved without deleting immutable audit history.
 * Permissions: AUTOMATIONS_MANAGE (OWNER, ADMIN).
 */
export async function DELETE(
  request: Request,
  props: { params: Promise<{ executionId: string }> },
) {
  try {
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);
    const { executionId } = await props.params;

    const result = await purgeDeadLetterExecution(workspaceId, executionId, auth);

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
      "DELETE /api/automations/dlq/[executionId]",
    );
  }
}
