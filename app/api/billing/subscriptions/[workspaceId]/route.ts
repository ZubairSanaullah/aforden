import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveWorkspaceId,
  handleBillingApiError,
} from "@/lib/utils/billingApiError";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { NON_TERMINAL_SUBSCRIPTION_STATUSES } from "@/lib/services/billing/subscriptionStateMachine";

interface RouteContext {
  params: Promise<{
    workspaceId: string;
  }>;
}

/**
 * GET /api/billing/subscriptions/[workspaceId]
 *
 * Retrieves current subscription, plan, and billing account status for a workspace.
 * Workspace-scoped read endpoint for internal dashboards.
 * Required permission: billing.view (OWNER, ADMIN).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { workspaceId: pathWorkspaceId } = await context.params;
    const { workspaceId, errorResponse } = resolveWorkspaceId(
      request,
      pathWorkspaceId,
    );
    if (errorResponse) return errorResponse;

    // 1. Authenticate & Authorize Workspace Context + RBAC
    const auth = await requireWorkspaceAuthorization(workspaceId);
    assertPermission(auth.membership.role, PERMISSIONS.BILLING_VIEW);

    // 2. Fetch Active or Latest Subscription with Plan and Account
    const subscription = await prisma.subscription.findFirst({
      where: {
        workspaceId,
      },
      include: {
        plan: {
          include: {
            features: true,
            prices: {
              where: { isActive: true },
            },
          },
        },
        account: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const hasActiveSubscription =
      !!subscription &&
      (NON_TERMINAL_SUBSCRIPTION_STATUSES as readonly string[]).includes(
        subscription.status,
      );

    return NextResponse.json(
      {
        success: true,
        data: {
          workspaceId,
          hasActiveSubscription,
          subscription: subscription ?? null,
          plan: subscription?.plan ?? null,
          account: subscription?.account ?? null,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    return handleBillingApiError(error, "GET /billing/subscriptions/[workspaceId]");
  }
}
