import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createCheckoutSession } from "@/lib/services/billing";
import { createCheckoutSchema } from "@/lib/validations/billing";
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
 * POST /api/workspaces/[workspaceId]/billing/checkout
 *
 * Initiates a provider checkout session for a new subscription.
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
    const validated = createCheckoutSchema.parse(body);

    // 3. Create Checkout Session
    const session = await createCheckoutSession(
      prisma,
      workspaceId,
      validated,
      {
        customerEmail: auth.user.email,
        customerName: auth.user.name,
      },
    );

    return NextResponse.json(
      {
        success: true,
        data: session,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleBillingApiError(error, "POST /billing/checkout");
  }
}
