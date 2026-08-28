import { NextResponse } from "next/server";
import {
  getAutomationRule,
  updateAutomationRule,
  deleteAutomationRule,
} from "@/lib/services/automation";
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
 * GET /api/automations/rules/[ruleId]
 *
 * Retrieves a single automation rule by ID with its full graph.
 * Permissions: AUTOMATIONS_VIEW (OWNER, ADMIN, MANAGER).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { ruleId } = await context.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);
    const rule = await getAutomationRule(workspaceId, ruleId, auth);

    return NextResponse.json(
      {
        success: true,
        data: rule,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "GET /api/automations/rules/[ruleId]");
  }
}

/**
 * PUT /api/automations/rules/[ruleId]
 * PATCH /api/automations/rules/[ruleId]
 *
 * Updates an automation rule and optionally replaces triggers/conditions/actions.
 * Permissions: AUTOMATIONS_MANAGE (OWNER, ADMIN).
 * Entitlement: FEATURE_AUTOMATIONS.
 */
export async function PUT(request: Request, context: RouteContext) {
  return handleUpdate(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleUpdate(request, context);
}

async function handleUpdate(request: Request, context: RouteContext) {
  try {
    const { ruleId } = await context.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);

    const body = await request.json().catch(() => {
      throw new SyntaxError("Invalid JSON in request body.");
    });

    const updated = await updateAutomationRule(workspaceId, ruleId, body, auth);

    return NextResponse.json(
      {
        success: true,
        data: updated,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "UPDATE /api/automations/rules/[ruleId]");
  }
}

/**
 * DELETE /api/automations/rules/[ruleId]
 *
 * Deletes an automation rule. Execution history is preserved (ruleId set to null).
 * Permissions: AUTOMATIONS_MANAGE (OWNER, ADMIN).
 * Entitlement: FEATURE_AUTOMATIONS.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { ruleId } = await context.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(request);
    if (errorResponse) return errorResponse;

    const auth = await requireWorkspaceAuthorization(workspaceId);
    const result = await deleteAutomationRule(workspaceId, ruleId, auth);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "DELETE /api/automations/rules/[ruleId]");
  }
}
