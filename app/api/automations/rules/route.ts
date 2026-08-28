import { NextResponse } from "next/server";
import {
  createAutomationRule,
  listAutomationRules,
} from "@/lib/services/automation";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
  resolveWorkspaceId,
  handleAutomationApiError,
} from "@/lib/utils/automationApiError";

/**
 * GET /api/automations/rules
 *
 * Lists automation rules with pagination, filtering, and sorting.
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
      isEnabled: searchParams.has("isEnabled")
        ? searchParams.get("isEnabled") === "true"
        : undefined,
      triggerType: searchParams.get("triggerType") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      page: searchParams.has("page") ? parseInt(searchParams.get("page")!, 10) : 1,
      pageSize: searchParams.has("pageSize") ? parseInt(searchParams.get("pageSize")!, 10) : 20,
      sortBy: (searchParams.get("sortBy") as any) ?? "createdAt",
      sortOrder: (searchParams.get("sortOrder") as any) ?? "desc",
    };

    const result = await listAutomationRules(workspaceId, query, auth);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "GET /api/automations/rules");
  }
}

/**
 * POST /api/automations/rules
 *
 * Creates a new automation rule with trigger, conditions, and actions.
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

    const rule = await createAutomationRule(workspaceId, body, auth);

    return NextResponse.json(
      {
        success: true,
        data: rule,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleAutomationApiError(error, "POST /api/automations/rules");
  }
}
