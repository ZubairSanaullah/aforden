import { NextResponse } from "next/server";
import { toggleAutomationRule } from "@/lib/services/automation";
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
 * POST /api/automations/rules/[ruleId]/toggle
 *
 * Toggles an automation rule enabled state.
 * Body: { isEnabled: boolean }
 * Permissions: AUTOMATIONS_MANAGE (OWNER, ADMIN).
 * Entitlement: FEATURE_AUTOMATIONS.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { ruleId } = await context.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);

    const body = await request.json().catch(() => {
      throw new SyntaxError("Invalid JSON in request body.");
    });

    const isEnabled = typeof body?.isEnabled === "boolean" ? body.isEnabled : true;
    const updated = await toggleAutomationRule(workspaceId, ruleId, isEnabled, auth);

    return NextResponse.json(
      {
        success: true,
        data: updated,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "POST /api/automations/rules/[ruleId]/toggle");
  }
}
