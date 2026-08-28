import { NextResponse } from "next/server";
import { testRunAutomationRule } from "@/lib/services/automation";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
  resolveWorkspaceId,
  handleAutomationApiError,
} from "@/lib/utils/automationApiError";

interface RouteContext {
  params: Promise<{
    ruleId: string;
  }>;
}

/**
 * POST /api/automations/rules/[ruleId]/test-run
 *
 * Executes a manual test run of the automation rule.
 * Body: { eventType?: string, sourceEntity?: string, sourceId?: string, payload?: Record<string, unknown> }
 * Permissions: AUTOMATIONS_RUN (OWNER, ADMIN, MANAGER).
 * Entitlement: FEATURE_AUTOMATIONS.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { ruleId } = await context.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);

    const body = await request.json().catch(() => ({}));

    const result = await testRunAutomationRule(workspaceId, ruleId, body, auth);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "POST /api/automations/rules/[ruleId]/test-run");
  }
}
