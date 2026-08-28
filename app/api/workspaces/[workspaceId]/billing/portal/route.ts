import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createCustomerPortalSession } from "@/lib/services/billing";
import { createPortalSchema } from "@/lib/validations/billing";
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
 * POST /api/workspaces/[workspaceId]/billing/portal
 *
 * Generates a provider customer portal session URL for managing cards, invoices,
 * and subscription details.
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
    const validated = createPortalSchema.parse(body);

    // 3. Create Portal Session
    const session = await createCustomerPortalSession(
      prisma,
      workspaceId,
      validated,
    );

    return NextResponse.json(
      {
        success: true,
        data: session,
      },
      { status: 200 },
    );
  } catch (error) {
    return handleBillingApiError(error, "POST /billing/portal");
  }
}
