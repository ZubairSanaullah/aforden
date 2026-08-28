import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { changeSubscriptionPlan } from "@/lib/services/billing";
import { changePlanSchema } from "@/lib/validations/billing";
import {
  resolveWorkspaceId,
  handleBillingApiError,
} from "@/lib/utils/billingApiError";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";

interface RouteContext {
  params: Promise<{
    workspaceId: string;
  }>;
}

/**
 * POST /api/workspaces/[workspaceId]/billing/change-plan
 *
 * Upgrades, downgrades, or modifies seat capacity for an existing active subscription.
 * Required permission: billing.manage (OWNER).
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { workspaceId: pathWorkspaceId } = await context.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(
      request,
      pathWorkspaceId,
    );
    if (errorResponse) return errorResponse;

    // 1. Authenticate & Authorize Workspace Context + RBAC
    const auth = await requireWorkspaceAuthorization(workspaceId);
    assertPermission(auth.membership.role, PERMISSIONS.BILLING_MANAGE);

    // 2. Parse & Validate Request Body
    const body = await request.json().catch(() => {
      throw new SyntaxError("Invalid JSON in request body.");
    });
    const validated = changePlanSchema.parse(body);

    // 3. Execute Plan Modification
    const updatedSubscription = await changeSubscriptionPlan(
      prisma,
      workspaceId,
      validated,
      auth.user.id
    );

    return NextResponse.json(
      {
        success: true,
        data: updatedSubscription,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleBillingApiError(error, "POST /billing/change-plan");
  }
}
