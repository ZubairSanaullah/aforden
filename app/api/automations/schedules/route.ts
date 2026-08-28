import { NextResponse } from "next/server";
import {
  listAutomationScheduleJobs,
  registerScheduleJob,
} from "@/lib/services/automation";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
  resolveWorkspaceId,
  handleAutomationApiError,
} from "@/lib/utils/automationApiError";

/**
 * GET /api/automations/schedules
 *
 * Lists scheduled automation jobs with optional rule and status filtering.
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
      isActive: searchParams.has("isActive")
        ? searchParams.get("isActive") === "true"
        : undefined,
      page: searchParams.has("page") ? parseInt(searchParams.get("page")!, 10) : 1,
      pageSize: searchParams.has("pageSize") ? parseInt(searchParams.get("pageSize")!, 10) : 20,
    };

    const result = await listAutomationScheduleJobs(workspaceId, query, auth);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "GET /api/automations/schedules");
  }
}

/**
 * POST /api/automations/schedules
 *
 * Registers a new scheduled job for an automation rule.
 * Permissions: AUTOMATIONS_MANAGE (OWNER, ADMIN).
 * Entitlement: FEATURE_AUTOMATIONS.
 */
export async function POST(request: Request) {
  try {
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);

    const body = await request.json().catch(() => {
      throw new SyntaxError("Invalid JSON in request body.");
    });

    const job = await registerScheduleJob(workspaceId, body, undefined, auth);

    return NextResponse.json(
      {
        success: true,
        data: job,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "POST /api/automations/schedules");
  }
}
