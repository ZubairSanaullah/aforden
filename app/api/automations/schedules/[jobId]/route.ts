import { NextResponse } from "next/server";
import {
  toggleAutomationScheduleJob,
  deleteAutomationScheduleJob,
} from "@/lib/services/automation";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
  resolveWorkspaceId,
  handleAutomationApiError,
} from "@/lib/utils/automationApiError";

interface RouteContext {
  params: Promise<{
    jobId: string;
  }>;
}

/**
 * PATCH /api/automations/schedules/[jobId]
 *
 * Updates or toggles a scheduled job active state.
 * Permissions: AUTOMATIONS_MANAGE (OWNER, ADMIN).
 * Entitlement: FEATURE_AUTOMATIONS.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { jobId } = await context.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);

    const body = await request.json().catch(() => {
      throw new SyntaxError("Invalid JSON in request body.");
    });

    const isActive = typeof body?.isActive === "boolean" ? body.isActive : true;
    const updated = await toggleAutomationScheduleJob(workspaceId, jobId, isActive, auth);

    return NextResponse.json(
      {
        success: true,
        data: updated,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "PATCH /api/automations/schedules/[jobId]");
  }
}

/**
 * DELETE /api/automations/schedules/[jobId]
 *
 * Deletes a scheduled job.
 * Permissions: AUTOMATIONS_MANAGE (OWNER, ADMIN).
 * Entitlement: FEATURE_AUTOMATIONS.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { jobId } = await context.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);
    const result = await deleteAutomationScheduleJob(workspaceId, jobId, auth);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "DELETE /api/automations/schedules/[jobId]");
  }
}
